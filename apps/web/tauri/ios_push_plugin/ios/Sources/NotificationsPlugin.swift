// Adapted from macro-inc/tauri-plugins 6ddd6600 (MIT); see LICENSE-MIT.
import Foundation
import PendingPushStore
import SwiftRs
import Tauri
import UIKit
import UserNotifications
import WebKit

private struct PermissionStatus: Encodable { let status: String }
private struct RegistrationStatus: Encodable { let isRegistered: Bool; let token: String? }
private struct RegistrationResult: Encodable { let success: Bool; let token: String?; let error: String? }
private struct WatchArgs: Decodable { let channel: Channel; let launchAware: Bool? }
private struct WatchResult: Encodable { let success: Bool }
private struct AcknowledgeArgs: Decodable { let deliveryId: String }
private struct ConfigureArgs: Decodable { let recipientId: String? }
private struct PendingResult: Encodable { let event: PendingPush? }
private struct DeliveryEvent: Encodable { let type: String; let payload: [String: String] }

final class NotificationsPlugin: Plugin, UNUserNotificationCenterDelegate {
    private var registrationInvoke: Invoke?
    private var notificationChannel: Channel?
    private var originalDelegate: UIApplicationDelegate?
    private var pendingStore: PendingPushStore?
    private var pendingStoreError: Error?
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var loadObservation: NSKeyValueObservation?
    private weak var appWebview: WKWebView?
    private var cover: UIView?
    private var frontendReady = false
    private var launchAware = false
    private var suppressPendingCover = false

    override init() {
        super.init()
        do {
            let directory = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true
            )
            pendingStore = try PendingPushStore(
                fileURL: directory.appendingPathComponent("notification-navigation/pending.json")
            )
        } catch {
            pendingStoreError = error
            Logger.error("[notification-open] phase=store_init outcome=failed")
        }
        UNUserNotificationCenter.current().delegate = self
    }

    @objc override public func load(webview: WKWebView) {
        super.load(webview: webview)
        appWebview = webview
        loadObservation = webview.observe(\.isLoading, options: [.new]) { [weak self] _, change in
            guard change.newValue == true, let self else { return }
            // A retained native channel belongs to the previous JavaScript
            // realm. New and old OTA bundles explicitly choose their contract.
            self.notificationChannel = nil
            self.launchAware = false
            self.frontendReady = false
            self.suppressPendingCover = false
            self.reveal()
        }
        let app = UIApplication.shared
        originalDelegate = app.delegate
        app.delegate = self
        for name in [UIApplication.willResignActiveNotification, UIScene.willDeactivateNotification] {
            lifecycleObservers.append(NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { [weak self] _ in self?.showCover() })
        }
        for name in [UIApplication.didBecomeActiveNotification, UIScene.didActivateNotification] {
            lifecycleObservers.append(NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { [weak self] _ in
                // Let launch response callbacks already queued on the main
                // thread run before deciding this is an ordinary icon resume.
                DispatchQueue.main.async { self?.didBecomeActive() }
            })
        }
    }

    deinit {
        for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) }
    }

    private static var nowMs: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private func store() throws -> PendingPushStore {
        if let pendingStore { return pendingStore }
        throw pendingStoreError ?? NSError(domain: "MacroPush", code: 1)
    }

    private func showCover() {
        guard launchAware, let webview = appWebview else { return }
        let surface = cover ?? UIView(frame: webview.bounds)
        surface.backgroundColor = .systemBackground
        surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        surface.isUserInteractionEnabled = true
        surface.accessibilityIdentifier = "notification-navigation-cover"
        if surface.superview !== webview {
            webview.addSubview(surface)
        }
        surface.frame = webview.bounds
        webview.bringSubviewToFront(surface)
        cover = surface
    }

    private func reveal() {
        // Keep the app-switcher/launch snapshot neutral while backgrounded.
        guard UIApplication.shared.applicationState == .active else { return }
        cover?.removeFromSuperview()
        cover = nil
    }

    private func didBecomeActive() {
        // Auth/retry UI can release the cover without consuming the intent.
        // Keep retrying delivery after sign-in even while that UI stays visible.
        if suppressPendingCover { reveal() }
        guard launchAware, frontendReady else {
            if !launchAware { reveal() }
            return
        }
        do {
            guard let event = try store().pending(at: Self.nowMs) else {
                reveal()
                return
            }
            // A previous route may have committed while its durable ack failed.
            // Re-delivery lets the live frontend retry that same delivery ID.
            deliverTap(event)
            Logger.info("[notification-open] phase=resume_retry delivery_id=\(event.deliveryId) timestamp_ms=\(Self.nowMs)")
        } catch {
            reveal()
            Logger.error("[notification-open] phase=resume_retry outcome=failed")
        }
    }

    @objc public func getPendingNotification(_ invoke: Invoke) {
        DispatchQueue.main.async {
            // Watch is installed first. A response that arrives after this
            // snapshot still reaches that listener, including hidden reloads.
            self.resolvePending(invoke)
        }
    }

    private func resolvePending(_ invoke: Invoke) {
        do {
            let event = try store().pending(at: Self.nowMs)
            launchAware = true
            frontendReady = true
            if event == nil || suppressPendingCover { reveal() } else { showCover() }
            invoke.resolve(PendingResult(event: event))
            Logger.info("[notification-open] phase=bootstrap pending=\(event != nil) timestamp_ms=\(Self.nowMs)")
        } catch {
            frontendReady = true
            reveal()
            invoke.reject("Unable to read pending notification navigation")
        }
    }

    @objc public func acknowledgeNotification(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AcknowledgeArgs.self)
        DispatchQueue.main.async {
            do {
                if try self.store().acknowledge(deliveryId: args.deliveryId) {
                    DispatchQueue.main.async {
                        if (try? self.store().pending(at: Self.nowMs)) == nil { self.reveal() }
                    }
                    Logger.info("[notification-open] phase=ack delivery_id=\(args.deliveryId) timestamp_ms=\(Self.nowMs)")
                }
                invoke.resolve()
            } catch {
                // The route already rendered. A persistence failure must not
                // trap it behind the cover; retain the intent for a later retry.
                self.reveal()
                invoke.reject("Unable to acknowledge notification navigation")
            }
        }
    }

    @objc public func clearPendingNotification(_ invoke: Invoke) {
        DispatchQueue.main.async {
            do {
                try self.store().clear()
                self.reveal()
                invoke.resolve()
            } catch {
                invoke.reject("Unable to clear notification navigation")
            }
        }
    }

    @objc public func releaseNotificationCover(_ invoke: Invoke) {
        DispatchQueue.main.async {
            self.suppressPendingCover = true
            self.frontendReady = true
            self.reveal()
            invoke.resolve()
        }
    }

    @objc public func watchNotifications(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchArgs.self)
        DispatchQueue.main.async {
            self.notificationChannel = args.channel
            self.launchAware = args.launchAware == true
            if !self.launchAware {
                self.frontendReady = true
                self.reveal()
            }
            do {
                if let event = try self.store().pending(at: Self.nowMs) {
                    if !self.suppressPendingCover { self.showCover() }
                    self.deliverTap(event)
                }
                invoke.resolve(WatchResult(success: true))
            } catch {
                invoke.reject("Unable to watch pending notification navigation")
            }
        }
    }

    @objc public func configureRecipient(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ConfigureArgs.self)
        DispatchQueue.main.async {
            do {
                try self.store().configureRecipient(args.recipientId)
                if try self.store().pending(at: Self.nowMs) == nil { self.reveal() }
                invoke.resolve()
            } catch {
                invoke.reject("Unable to configure notification recipient")
            }
        }
    }

    @objc public func unwatchNotifications(_ invoke: Invoke) {
        DispatchQueue.main.async {
            self.notificationChannel = nil
            invoke.resolve()
        }
    }

    @discardableResult
    private func send<T: Encodable>(_ event: T) -> Bool {
        // Channel.send does not acknowledge receipt. The persisted intent stays
        // available to a new JS context even when this call returns successfully.
        guard let channel = notificationChannel else { return false }
        do {
            try channel.send(event)
            return true
        } catch {
            notificationChannel = nil
            Logger.error("[notification-open] phase=delivery outcome=failed")
            return false
        }
    }

    private func deliverTap(_ event: PendingPush) {
        guard send(event) else {
            // A live frontend may lose its listener without remounting. Keep
            // the intent for reconnect, but do not leave its UI covered. A new
            // WebView still waits for bootstrap before revealing any content.
            if frontendReady { reveal() }
            return
        }
        if !launchAware {
            // Older frontend bundles cannot acknowledge. Preserve their
            // historical delivery contract without leaving a native cover up.
            do { try store().acknowledge(deliveryId: event.deliveryId) }
            catch { Logger.error("[notification-open] phase=legacy_ack outcome=failed") }
        }
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else {
            completionHandler()
            return
        }
        DispatchQueue.main.async {
            defer { completionHandler() }
            let notification = response.notification
            let payload = Self.stringPayload(notification.request.content.userInfo)
                .filter { ["notificationId", "recipientId", "navigation"].contains($0.key) }
            guard let notificationId = payload["notificationId"], !notificationId.isEmpty else { return }
            let event = PendingPush(
                type: UIApplication.shared.applicationState == .active ? "FOREGROUND_TAP" : "BACKGROUND_TAP",
                payload: payload, deliveryId: UUID().uuidString, receivedAtMs: Self.nowMs
            )
            let sourceId = "\(notification.request.identifier):\(notification.date.timeIntervalSince1970)"
            do {
                guard let captured = try self.store().capture(sourceId: sourceId, event: event) else { return }
                self.suppressPendingCover = false
                self.showCover()
                self.deliverTap(captured)
                Logger.info("[notification-open] phase=capture delivery_id=\(captured.deliveryId) timestamp_ms=\(captured.receivedAtMs)")
            } catch {
                self.reveal()
                self.send(event)
                Logger.error("[notification-open] phase=capture outcome=failed")
            }
        }
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        DispatchQueue.main.async {
            self.send(DeliveryEvent(type: "FOREGROUND_DELIVERY", payload: Self.stringPayload(notification.request.content.userInfo)))
            completionHandler([.banner, .sound, .badge, .list])
        }
    }

    private static func stringPayload(_ userInfo: [AnyHashable: Any]) -> [String: String] {
        userInfo.reduce(into: [:]) { result, pair in
            guard let key = pair.key as? String else { return }
            if let value = pair.value as? String {
                result[key] = value
            } else if JSONSerialization.isValidJSONObject(pair.value),
                      let data = try? JSONSerialization.data(withJSONObject: pair.value),
                      let value = String(data: data, encoding: .utf8) {
                result[key] = value
            } else {
                result[key] = String(describing: pair.value)
            }
        }
    }

    @objc override public func checkPermissions(_ invoke: Invoke) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .notDetermined: status = "prompt"
            case .denied: status = "denied"
            case .authorized, .provisional, .ephemeral: status = "granted"
            @unknown default: status = "prompt"
            }
            invoke.resolve(PermissionStatus(status: status))
        }
    }

    @objc override public func requestPermissions(_ invoke: Invoke) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            invoke.resolve(PermissionStatus(status: granted ? "granted" : "denied"))
        }
    }

    @objc public func checkRegistrationStatus(_ invoke: Invoke) {
        DispatchQueue.main.async {
            invoke.resolve(RegistrationStatus(
                isRegistered: UIApplication.shared.isRegisteredForRemoteNotifications,
                token: UserDefaults.standard.string(forKey: "deviceToken")
            ))
        }
    }

    @objc public func registerForRemoteNotifications(_ invoke: Invoke) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            DispatchQueue.main.async {
                guard granted else {
                    invoke.resolve(RegistrationResult(success: false, token: nil, error: error?.localizedDescription ?? "Push notifications are not authorized"))
                    return
                }
                if let token = UserDefaults.standard.string(forKey: "deviceToken") {
                    invoke.resolve(RegistrationResult(success: true, token: token, error: nil))
                    UIApplication.shared.registerForRemoteNotifications()
                    return
                }
                self.registrationInvoke = invoke
                UIApplication.shared.registerForRemoteNotifications()
                DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                    guard self.registrationInvoke === invoke else { return }
                    self.registrationInvoke = nil
                    invoke.resolve(RegistrationResult(success: false, token: nil, error: "Push registration timed out"))
                }
            }
        }
    }
}

extension NotificationsPlugin: UIApplicationDelegate {
    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "deviceToken")
        registrationInvoke?.resolve(RegistrationResult(success: true, token: token, error: nil))
        registrationInvoke = nil
    }

    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        registrationInvoke?.resolve(RegistrationResult(success: false, token: nil, error: error.localizedDescription))
        registrationInvoke = nil
    }

    public func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        if application.applicationState != .active {
            send(DeliveryEvent(type: "BACKGROUND_DELIVERY", payload: Self.stringPayload(userInfo)))
        }
        completionHandler(.newData)
    }

    public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        originalDelegate?.application?(application, didFinishLaunchingWithOptions: launchOptions) ?? false
    }

    public func application(_ application: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        originalDelegate?.application?(application, open: url, options: options) ?? false
    }

    public func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        originalDelegate?.application?(application, continue: userActivity, restorationHandler: restorationHandler) ?? false
    }

    public func applicationDidBecomeActive(_ application: UIApplication) { originalDelegate?.applicationDidBecomeActive?(application) }
    public func applicationWillResignActive(_ application: UIApplication) { originalDelegate?.applicationWillResignActive?(application) }
    public func applicationWillEnterForeground(_ application: UIApplication) { originalDelegate?.applicationWillEnterForeground?(application) }
    public func applicationDidEnterBackground(_ application: UIApplication) { originalDelegate?.applicationDidEnterBackground?(application) }
    public func applicationWillTerminate(_ application: UIApplication) { originalDelegate?.applicationWillTerminate?(application) }
}

@_cdecl("init_plugin_notifications")
func initPlugin() -> Plugin { NotificationsPlugin() }
