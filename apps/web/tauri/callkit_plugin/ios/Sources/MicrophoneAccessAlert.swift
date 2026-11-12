import UIKit

/// iOS asks for the microphone once; after a denial only Settings can turn it
/// back on, so a call that can't unmute says where to go. The alert has its own
/// window: the call overlay brings itself to the front of the app window on
/// every layout pass, which would cover an alert presented there.
final class MicrophoneAccessAlert: @unchecked Sendable {
    private var window: UIWindow?

    func show() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.window == nil else { return }
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else {
                callKitLog("Microphone access alert skipped; no window scene")
                return
            }

            let alert = UIAlertController(
                title: "Microphone access is off",
                message: "Turn on Microphone for Macro in Settings so others in the call can hear you.",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "Not Now", style: .cancel) { [weak self] _ in
                self?.close()
            })
            alert.addAction(UIAlertAction(title: "Open Settings", style: .default) { [weak self] _ in
                self?.close()
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(url)
            })

            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert
            window.rootViewController = UIViewController()
            window.isHidden = false
            self.window = window
            window.rootViewController?.present(alert, animated: true)
            callKitLog("Microphone access alert shown")
        }
    }

    /// A call that ended while the alert was up no longer needs it.
    func dismiss() {
        DispatchQueue.main.async { [weak self] in
            self?.close()
        }
    }

    private func close() {
        window?.rootViewController?.dismiss(animated: false)
        window?.isHidden = true
        window = nil
    }
}
