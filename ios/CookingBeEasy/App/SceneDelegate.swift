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
        window.rootViewController = WebAppViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}
