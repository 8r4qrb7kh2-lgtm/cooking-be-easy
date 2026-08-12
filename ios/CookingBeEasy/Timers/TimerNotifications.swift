import Foundation
import UserNotifications
import WebKit

/// One cooking timer as the web app sees it.
struct WebTimer {
    let id: String
    let label: String
    let fireAt: Date

    init?(json: Any) {
        guard
            let fields = json as? [String: Any],
            let id = fields["id"] as? String,
            let label = fields["label"] as? String,
            let fireAtMilliseconds = fields["fireAt"] as? Double
        else {
            return nil
        }

        self.id = id
        self.label = label
        self.fireAt = Date(timeIntervalSince1970: fireAtMilliseconds / 1000)
    }
}

/// Mirrors the web app's cooking timers as iOS local notifications.
///
/// A web view has no Notification API, so on the web the timer tray can only
/// alert you while the app is open and on screen — which is exactly when you
/// don't need telling. These notifications fire even if the app has been
/// backgrounded or closed outright.
final class TimerNotifications: NSObject {
    static let shared = TimerNotifications()

    private let center = UNUserNotificationCenter.current()
    private let identifierPrefix = "cooking-timer."

    func start() {
        center.delegate = self
    }

    /// Bring the scheduled notifications in line with the timers the web app is
    /// now showing: drop the ones that were cancelled or have finished, add the
    /// ones that are new. Called on every change to the tray.
    func sync(timers: [WebTimer]) {
        // A timer that is already due doesn't need a notification — the page is
        // open and about to alert on its own.
        let wanted = timers.filter { $0.fireAt.timeIntervalSinceNow > 1 }
        let wantedIdentifiers = Set(wanted.map(identifier(for:)))

        center.getPendingNotificationRequests { [weak self] pending in
            guard let self else { return }

            let scheduled = Set(
                pending.map(\.identifier).filter { $0.hasPrefix(self.identifierPrefix) }
            )

            let stale = scheduled.subtracting(wantedIdentifiers)
            if !stale.isEmpty {
                self.center.removePendingNotificationRequests(withIdentifiers: Array(stale))
            }

            let missing = wanted.filter { !scheduled.contains(self.identifier(for: $0)) }
            guard !missing.isEmpty else { return }

            // Only ask for permission once there is something to deliver, so the
            // prompt lands when you start your first timer rather than at launch.
            self.center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                guard granted else { return }
                missing.forEach(self.schedule)
            }
        }
    }

    private func schedule(_ timer: WebTimer) {
        let content = UNMutableNotificationContent()
        content.title = "Timer done"
        content.body = timer.label
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: identifier(for: timer),
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(
                timeInterval: max(1, timer.fireAt.timeIntervalSinceNow),
                repeats: false
            )
        )

        center.add(request)
    }

    private func identifier(for timer: WebTimer) -> String {
        identifierPrefix + timer.id
    }
}

extension TimerNotifications: UNUserNotificationCenterDelegate {
    /// Show the alert even with the app open: the tray's own toast is silent and
    /// only exists on the cook screens, so it can't be relied on to reach you.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}

/// Receives the timer list the web app posts on every change. Kept separate
/// from the view controller because `WKUserContentController` retains its
/// message handlers, which would otherwise leak the whole screen.
final class TimerScriptMessageHandler: NSObject, WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard
            let payload = message.body as? [String: Any],
            let rawTimers = payload["timers"] as? [Any]
        else {
            return
        }

        TimerNotifications.shared.sync(timers: rawTimers.compactMap(WebTimer.init(json:)))
    }
}
