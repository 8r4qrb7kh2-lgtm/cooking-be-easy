import AuthenticationServices
import SafariServices
import UIKit
import WebKit

/// The whole app: a web view onto the deployed site, plus the handful of things
/// a web view can't do for itself — Google sign-in, JavaScript dialogs, links
/// out to other sites, and a way back when the network is down.
final class WebAppViewController: UIViewController {
    private lazy var webView = makeWebView()
    private lazy var loadingView = LoadingView()
    private lazy var errorView = ConnectionErrorView { [weak self] in self?.loadSite() }
    private let refreshControl = UIRefreshControl()
    private var authSession: ASWebAuthenticationSession?
    private var hasLoadedOnce = false

    /// The site is light in every appearance, so the status bar is always dark.
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()

        // Shows through behind the status bar, where the site's white header
        // ends — any other colour reads as a seam.
        view.backgroundColor = UIColor(named: "Surface")

        addWebView()
        addOverlays()
        loadSite()
    }

    // MARK: - Setup

    private func makeWebView() -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(
            TimerScriptMessageHandler(),
            name: AppConfig.timerMessageHandlerName
        )
        contentController.addUserScript(
            WKUserScript(
                source: Self.viewportScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        // Appended to the stock user agent. lib/native.ts keys off it.
        configuration.applicationNameForUserAgent = AppConfig.userAgentTag
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        // What you see when you overscroll, top or bottom; both ends of the page
        // are the site's white chrome.
        webView.scrollView.backgroundColor = UIColor(named: "Surface")
        return webView
    }

    private func addWebView() {
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        // Top and sides stop at the safe area so nothing hides behind the notch.
        // The bottom runs to the edge of the screen instead, which lets the
        // site's tab bar paint through the home indicator strip — it pads its
        // own contents with env(safe-area-inset-bottom).
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        refreshControl.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
    }

    private func addOverlays() {
        for overlay in [loadingView, errorView] as [UIView] {
            overlay.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(overlay)

            NSLayoutConstraint.activate([
                overlay.topAnchor.constraint(equalTo: view.topAnchor),
                overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
        }

        errorView.isHidden = true
    }

    /// iOS zooms the page in whenever you focus an input smaller than 16px, and
    /// several of the site's inputs are. Capping the scale stops the lurch.
    private static let viewportScript = """
    (function () {
      var viewport = document.querySelector('meta[name=viewport]');
      if (!viewport) return;
      var content = viewport.getAttribute('content') || '';
      if (content.indexOf('maximum-scale') !== -1) return;
      viewport.setAttribute('content', content + ', maximum-scale=1');
    })();
    """

    // MARK: - Loading

    private func loadSite() {
        errorView.isHidden = true
        webView.load(URLRequest(url: AppConfig.siteURL))
    }

    @objc private func handleRefresh() {
        webView.reload()
    }

    private func handleLoadFailure(_ error: Error) {
        refreshControl.endRefreshing()

        // A cancelled load is just what a redirect or a quick second tap looks
        // like from here.
        guard (error as NSError).code != NSURLErrorCancelled else { return }

        loadingView.dismiss()

        // If there is already a usable page on screen, leave it there — the
        // error screen is for having nothing to fall back to.
        guard !hasLoadedOnce else { return }
        errorView.isHidden = false
    }

    // MARK: - Sign-in

    /// Google rejects OAuth inside an embedded web view, so the sign-in
    /// navigation gets lifted into a real Safari session. See lib/native.ts for
    /// the other half of this.
    private func startSignIn(with url: URL) {
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: AppConfig.authCallbackScheme
        ) { [weak self] callbackURL, error in
            guard let self else { return }
            self.authSession = nil

            if let callbackURL {
                self.finishSignIn(with: callbackURL)
                return
            }

            guard let error else { return }
            let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
            if !cancelled {
                self.presentAlert(title: "Sign-in failed", message: error.localizedDescription)
            }
        }

        session.presentationContextProvider = self
        session.start()
        authSession = session
    }

    /// The shell only ferries the auth code back. The web view is the side
    /// holding the PKCE verifier, so loading the destination with `?code=` hands
    /// the exchange to it — AuthProvider picks the code up from there.
    private func finishSignIn(with callbackURL: URL) {
        let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value
        }

        if let message = value("error") {
            presentAlert(title: "Sign-in failed", message: message)
            return
        }

        guard let code = value("code") else {
            webView.reload()
            return
        }

        var destination = URLComponents(url: AppConfig.siteURL, resolvingAgainstBaseURL: false)
        var query = [URLQueryItem(name: "code", value: code)]

        if let next = value("next"), next.hasPrefix("/"), !next.hasPrefix("//"),
           let parsed = URLComponents(string: next) {
            destination?.path = parsed.path
            query.append(contentsOf: parsed.queryItems ?? [])
        } else {
            destination?.path = AppConfig.defaultPath
        }

        destination?.queryItems = query

        guard let url = destination?.url else { return }
        webView.load(URLRequest(url: url))
    }

    // MARK: - Helpers

    private func open(external url: URL) {
        guard let scheme = url.scheme?.lowercased() else { return }

        if scheme == "http" || scheme == "https" {
            // Recipe sources and shared links: keep them in the app, but in a
            // browser view rather than the app's own web view.
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = UIColor(named: "Brand")
            present(safari, animated: true)
            return
        }

        UIApplication.shared.open(url)
    }

    private func presentAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - Navigation

extension WebAppViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.scheme == AppConfig.authCallbackScheme {
            decisionHandler(.cancel)
            finishSignIn(with: url)
            return
        }

        if AppConfig.isSignInURL(url) {
            decisionHandler(.cancel)
            startSignIn(with: url)
            return
        }

        if navigationAction.navigationType == .linkActivated, !AppConfig.isSiteURL(url) {
            decisionHandler(.cancel)
            open(external: url)
            return
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedOnce = true
        refreshControl.endRefreshing()
        loadingView.dismiss()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        handleLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS reclaimed the web content process while the app sat in the
        // background. Without this you come back to a blank white screen.
        webView.reload()
    }
}

// MARK: - Web view UI

extension WebAppViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // target="_blank". There are no second windows here, so site links go to
        // the main web view and everything else out to a browser.
        guard let url = navigationAction.request.url else { return nil }

        if AppConfig.isSiteURL(url) {
            webView.load(URLRequest(url: url))
        } else {
            open(external: url)
        }

        return nil
    }

    // A web view silently discards JavaScript dialogs unless they are handled
    // here, which would quietly break every confirm() the site puts in front of
    // a delete.

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        present(alert, animated: true)
    }
}

// MARK: - Sign-in presentation

extension WebAppViewController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        view.window ?? ASPresentationAnchor()
    }
}
