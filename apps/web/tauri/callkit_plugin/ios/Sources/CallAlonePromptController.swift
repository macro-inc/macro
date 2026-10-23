import Foundation
import UIKit
import UserNotifications

/// Native prompt for the server's alone-in-call timeout.
///
/// While the app is active the prompt is an alert in its own window at alert
/// level. The call overlay brings itself to the front of the webview's window
/// on every apply, so an alert presented in that window would end up behind
/// the drawer. While the app is not active the prompt is a local notification,
/// and the alert follows when the app next becomes active if the prompt is
/// still pending. Main-thread only.
final class CallAlonePromptController {
    var onStay: ((String) -> Void)?
    var onLeave: (() -> Void)?

    private static let title = "You're the only one here"

    private let windowSceneProvider: () -> UIWindowScene?
    private var prompt: (callId: String, endsAtMs: Double)?
    private var promptWindow: UIWindow?
    private var alert: UIAlertController?
    private var expiry: DispatchWorkItem?
    private var postedNotificationIds: Set<String> = []
    private var didBecomeActiveObserver: NSObjectProtocol?

    init(windowSceneProvider: @escaping () -> UIWindowScene?) {
        self.windowSceneProvider = windowSceneProvider
        didBecomeActiveObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.presentPendingPromptIfNeeded()
        }
    }

    deinit {
        if let didBecomeActiveObserver {
            NotificationCenter.default.removeObserver(didBecomeActiveObserver)
        }
    }

    /// Shows the server's warning that the call ends at `endsAtMs` (epoch ms).
    /// Repeating the same warning is a no-op; a new `endsAtMs` updates it.
    func show(callId: String, endsAtMs: Double) {
        let remainingMs = endsAtMs - Self.nowMs()
        guard remainingMs > 0 else {
            callKitLog("Ignoring alone prompt that already expired callId=\(callId) endsAtMs=\(endsAtMs)")
            return
        }
        if let prompt, Self.isSameCall(prompt.callId, callId), prompt.endsAtMs == endsAtMs {
            callKitLog("Alone prompt already pending callId=\(callId) endsAtMs=\(endsAtMs)")
            return
        }

        prompt = (callId: callId, endsAtMs: endsAtMs)
        scheduleExpiry(callId: callId, afterMs: remainingMs)
        let message = Self.message(remainingMs: remainingMs)
        if UIApplication.shared.applicationState == .active {
            presentAlert(callId: callId, message: message)
        } else {
            callKitLog("App not active; posting alone prompt notification callId=\(callId)")
            postNotification(callId: callId, body: message)
        }
    }

    /// The session's own backstop when the server's warning cannot reach the
    /// suspended webview.
    func notifyInBackground(callId: String) {
        callKitLog("Posting alone backstop notification callId=\(callId)")
        postNotification(
            callId: callId,
            body: "This call will end in about 2 minutes unless you open Macro and choose to stay."
        )
    }

    /// Removes the alert and the pending or delivered notification for `callId`.
    func dismiss(callId: String) {
        removeNotification(callId: callId)
        guard let prompt, Self.isSameCall(prompt.callId, callId) else { return }
        callKitLog("Dismissing alone prompt callId=\(callId)")
        clearPrompt()
    }

    /// Call teardown: removes the alert and every notification posted for it.
    func reset() {
        if prompt != nil {
            callKitLog("Resetting alone prompt")
        }
        clearPrompt()
        guard !postedNotificationIds.isEmpty else { return }
        let identifiers = Array(postedNotificationIds)
        postedNotificationIds.removeAll()
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    private func presentPendingPromptIfNeeded() {
        guard let prompt, alert == nil else { return }
        let remainingMs = prompt.endsAtMs - Self.nowMs()
        guard remainingMs > 0 else { return }
        callKitLog("App became active; presenting pending alone prompt callId=\(prompt.callId)")
        presentAlert(callId: prompt.callId, message: Self.message(remainingMs: remainingMs))
    }

    private func presentAlert(callId: String, message: String) {
        // The alert replaces the notification as the prompt.
        removeNotification(callId: callId)
        if let alert {
            alert.message = message
            return
        }
        guard let windowScene = windowSceneProvider() else {
            callKitLog("Alone prompt has no window scene; keeping it pending callId=\(callId)", level: .error)
            return
        }

        let window = UIWindow(windowScene: windowScene)
        window.windowLevel = .alert
        window.backgroundColor = .clear
        let rootViewController = UIViewController()
        rootViewController.view.backgroundColor = .clear
        window.rootViewController = rootViewController
        window.isHidden = false

        let alert = UIAlertController(title: Self.title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Leave", style: .destructive) { [weak self] _ in
            self?.choose(stay: false)
        })
        let stay = UIAlertAction(title: "Stay in call", style: .default) { [weak self] _ in
            self?.choose(stay: true)
        }
        alert.addAction(stay)
        alert.preferredAction = stay

        promptWindow = window
        self.alert = alert
        callKitLog("Presenting alone prompt callId=\(callId)")
        rootViewController.present(alert, animated: true)
    }

    private func choose(stay: Bool) {
        guard let prompt else { return }
        callKitLog("Alone prompt choice=\(stay ? "stay" : "leave") callId=\(prompt.callId)")
        removeNotification(callId: prompt.callId)
        clearPrompt()
        if stay {
            onStay?(prompt.callId)
        } else {
            onLeave?()
        }
    }

    private func scheduleExpiry(callId: String, afterMs remainingMs: Double) {
        expiry?.cancel()
        let expiry = DispatchWorkItem { [weak self] in
            callKitLog("Alone prompt expired callId=\(callId)")
            self?.dismiss(callId: callId)
        }
        self.expiry = expiry
        DispatchQueue.main.asyncAfter(wallDeadline: .now() + remainingMs / 1000, execute: expiry)
    }

    private func clearPrompt() {
        prompt = nil
        expiry?.cancel()
        expiry = nil
        guard let alert else { return }
        let window = promptWindow
        self.alert = nil
        promptWindow = nil
        // An action tap has already dismissed the alert.
        if alert.presentingViewController != nil {
            alert.dismiss(animated: true) { window?.isHidden = true }
        } else {
            window?.isHidden = true
        }
    }

    private func postNotification(callId: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = Self.title
        content.body = body
        content.sound = .default
        content.userInfo = ["callId": callId]
        let identifier = Self.notificationIdentifier(callId: callId)
        postedNotificationIds.insert(identifier)
        // Uses the authorization the app already holds for push; never prompts.
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                callKitLog("Failed to post alone prompt notification callId=\(callId): \(error)", level: .error)
            }
        }
    }

    private func removeNotification(callId: String) {
        let identifier = Self.notificationIdentifier(callId: callId)
        guard postedNotificationIds.remove(identifier) != nil else { return }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }

    private static func notificationIdentifier(callId: String) -> String {
        "call-alone-prompt.\(callId.lowercased())"
    }

    /// JS sends lowercase UUIDs; native UUID strings are uppercase.
    private static func isSameCall(_ lhs: String, _ rhs: String) -> Bool {
        lhs.caseInsensitiveCompare(rhs) == .orderedSame
    }

    private static func message(remainingMs: Double) -> String {
        let minutes = max(1, Int((remainingMs / 60_000).rounded()))
        return "This call will end in about \(minutes) \(minutes == 1 ? "minute" : "minutes") unless you stay."
    }

    private static func nowMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }
}
