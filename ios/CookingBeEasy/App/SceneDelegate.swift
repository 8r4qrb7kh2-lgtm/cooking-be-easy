import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        // The site has one set of colours and they are all light, so don't let
        // the system tint the native chrome around it.
        window.overrideUserInterfaceStyle = .light
        let webApp = WebAppViewController()
        window.rootViewController = webApp
        window.makeKeyAndVisible()
        self.window = window

        if let shortcutItem = connectionOptions.shortcutItem {
            handle(shortcutItem)
        }
    }

    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(handle(shortcutItem))
    }

    @discardableResult
    private func handle(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
        guard shortcutItem.type == AppConfig.addIngredientShortcutType,
              let webApp = window?.rootViewController as? WebAppViewController
        else { return false }

        webApp.promptForQuickAddIngredient()
        return true
    }
}
