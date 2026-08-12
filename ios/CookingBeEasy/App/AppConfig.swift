import Foundation

/// Everything the shell needs to know about the site it wraps.
///
/// The values marked "must match" are shared with the web app in `lib/native.ts`
/// — change one and you have to change the other.
enum AppConfig {
    /// The deployed Next.js app. This shell is a window onto it, not a copy of
    /// it: the recipe data, the AI ingredient parsing and the pricing lookups
    /// all live server-side, so there is nothing to bundle.
    static let siteURL = URL(string: "https://cooking-be-easy.vercel.app")!

    /// Where to land after signing in.
    static let defaultPath = "/recipes"

    /// Appended to the web view's user agent. Must match `NATIVE_APP_UA_TAG`.
    static let userAgentTag = "CookingBeEasyiOS/1.0"

    /// Sign-in returns to the app on this scheme. Must match
    /// `NATIVE_APP_URL_SCHEME`.
    static let authCallbackScheme = "cookingbeeasy"

    /// Must match `NATIVE_TIMER_MESSAGE_HANDLER`.
    static let timerMessageHandlerName = "cookingTimers"

    /// Pages that belong to the app itself. Anything else is a link out.
    static func isSiteURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased(), let siteHost = siteURL.host?.lowercased() else {
            return false
        }
        return host == siteHost
    }

    /// Google refuses to run OAuth inside an embedded web view, so these
    /// navigations get lifted out into a real Safari session instead.
    static func isSignInURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        if host == "accounts.google.com" { return true }
        return host.hasSuffix(".supabase.co") && url.path.hasPrefix("/auth/v1/authorize")
    }
}
