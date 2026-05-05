import CallKit
import PushKit
import Tauri
import WebKit

class CallKitPlugin: Plugin, CXProviderDelegate, PKPushRegistryDelegate {
    private var provider: CXProvider!
    private let callController = CXCallController()
    private var registry: PKPushRegistry!

    // Keyed by call UUID — holds the channelId so it's available when CXAnswerCallAction fires.
    private var pendingCalls: [UUID: String] = [:]

    override public func load(webview: WKWebView) {
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: .main)

        registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
    }

    // MARK: - PKPushRegistryDelegate

    public func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02.2hhx", $0) }.joined()
        trigger("voip-token-updated", data: ["token": token])
    }

    public func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else { completion(); return }

        let dict = payload.dictionaryPayload
        let channelId = dict["channelId"] as? String ?? ""
        let callerName = dict["callerName"] as? String ?? "Incoming Call"
        let callIdString = dict["callId"] as? String ?? ""
        let uuid = UUID(uuidString: callIdString) ?? UUID()

        pendingCalls[uuid] = channelId

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: channelId)
        update.localizedCallerName = callerName
        update.hasVideo = false

        // iOS 13+: must call reportNewIncomingCall synchronously within this delegate.
        // If we don't, iOS will terminate the app.
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if let error = error {
                // CallKit refused (e.g. Do Not Disturb, max calls reached).
                // Still must complete the PushKit handler.
                self?.pendingCalls.removeValue(forKey: uuid)
            }
            completion()
        }

        trigger("incoming-call", data: [
            "callId": callIdString,
            "channelId": channelId,
            "callerName": callerName,
        ])
    }

    // MARK: - CXProviderDelegate

    public func providerDidReset(_ provider: CXProvider) {
        pendingCalls.removeAll()
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        let channelId = pendingCalls[action.callUUID] ?? ""
        trigger("call-answered", data: [
            "callId": action.callUUID.uuidString,
            "channelId": channelId,
        ])
        action.fulfill()
        pendingCalls.removeValue(forKey: action.callUUID)
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        trigger("call-ended", data: [
            "callId": action.callUUID.uuidString,
        ])
        action.fulfill()
        pendingCalls.removeValue(forKey: action.callUUID)
    }

    // MARK: - Tauri command

    /// Called by the JS layer when the user leaves a call from within the app,
    /// so the system CallKit UI is dismissed.
    @objc public func endActiveCall(_ invoke: Invoke) {
        guard let uuid = pendingCalls.keys.first else {
            invoke.resolve()
            return
        }
        let transaction = CXTransaction(action: CXEndCallAction(call: uuid))
        callController.request(transaction) { _ in }
        pendingCalls.removeAll()
        invoke.resolve()
    }
}

@_cdecl("init_plugin_call_kit")
func initPlugin() -> Plugin {
    return CallKitPlugin()
}
