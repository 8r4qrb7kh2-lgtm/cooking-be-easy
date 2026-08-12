import UIKit

/// Covers the web view until the first page has painted, so the hand-off from
/// the launch screen is one continuous shot of the logo rather than a flash of
/// white.
final class LoadingView: UIView {
    private let spinner = UIActivityIndicatorView(style: .medium)

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = UIColor(named: "LaunchBackground")

        let logo = UIImageView(image: UIImage(named: "AppLogo"))
        logo.contentMode = .scaleAspectFit
        logo.translatesAutoresizingMaskIntoConstraints = false

        spinner.color = UIColor(named: "Brand")
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()

        addSubview(logo)
        addSubview(spinner)

        NSLayoutConstraint.activate([
            logo.centerXAnchor.constraint(equalTo: centerXAnchor),
            // Sits a little above centre, where the eye expects it.
            logo.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -40),
            logo.widthAnchor.constraint(equalToConstant: 160),
            logo.heightAnchor.constraint(equalToConstant: 160),

            spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
            spinner.topAnchor.constraint(equalTo: logo.bottomAnchor, constant: 28),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func dismiss() {
        guard !isHidden else { return }

        UIView.animate(withDuration: 0.25) {
            self.alpha = 0
        } completion: { _ in
            self.isHidden = true
            self.spinner.stopAnimating()
        }
    }
}
