// The iOS app in `ios/` is a thin native shell around this site: it loads the
// production URL in a WKWebView and tags its user agent so the web code can
// tell it apart from Mobile Safari.
//
// The one thing that genuinely differs is Google sign-in. Google refuses OAuth
// inside an embedded web view, so the shell intercepts the sign-in navigation
// and runs it in a real Safari session instead. That session cannot see the web
// view's cookies, so `/auth/callback` bounces the auth code back to the app over
// this URL scheme and the web view — which holds the PKCE verifier — finishes
// the exchange itself.

export const NATIVE_APP_UA_TAG = "CookingBeEasyiOS";

export const NATIVE_APP_URL_SCHEME = "cookingbeeasy";

export const NATIVE_AUTH_CALLBACK_URL = `${NATIVE_APP_URL_SCHEME}://auth-callback`;

export function isNativeApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes(NATIVE_APP_UA_TAG);
}

/** Name of the WKScriptMessageHandler the shell registers for cooking timers. */
export const NATIVE_TIMER_MESSAGE_HANDLER = "cookingTimers";

export interface NativeTimerNotification {
  id: string;
  label: string;
  /** When the timer is due, in epoch milliseconds. */
  fireAt: number;
}

interface WebKitWindow {
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (message: unknown) => void }>;
  };
}

/**
 * Mirror the pending timers as iOS local notifications.
 *
 * A web view has no Notification API at all, so on its own the timer tray can
 * only alert you while the app is open and on screen — no good when the phone
 * is in your pocket and the pasta is boiling. The shell reconciles this list
 * into scheduled notifications that fire even if the app has been closed.
 */
export function syncNativeTimerNotifications(timers: NativeTimerNotification[]) {
  if (typeof window === "undefined") return;

  const handler = (window as WebKitWindow).webkit?.messageHandlers?.[
    NATIVE_TIMER_MESSAGE_HANDLER
  ];
  if (!handler) return;

  try {
    handler.postMessage({ timers });
  } catch {
    // Best effort: the in-page timers keep working regardless.
  }
}
