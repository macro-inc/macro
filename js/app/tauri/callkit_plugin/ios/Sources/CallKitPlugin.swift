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

    // The UUID of the most recently reported incoming call, used by endActiveCall.
    private var activeCallUUID: UUID?

    // Last VoIP token received from PushKit; may arrive before the JS listener is ready.
    private var cachedVoipToken: String?

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
        cachedVoipToken = token
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
        guard let uuid = UUID(uuidString: callIdString) else {
            // iOS terminates apps that skip reportNewIncomingCall inside this
            // delegate. Report a ghost call and immediately end it as failed so
            // the system requirement is satisfied while surfacing the server bug.
            print("[CallKit] Invalid callId '\(callIdString)' in VoIP payload: \(dict)")
            let fallbackUUID = UUID()
            provider.reportNewIncomingCall(with: fallbackUUID, update: CXCallUpdate()) { [weak self] _ in
                self?.provider.reportCall(with: fallbackUUID, endedAt: nil, reason: .failed)
                completion()
            }
            return
        }

        // Enforce the single-call invariant: if a stale entry exists (duplicate
        // delivery or network retry), evict it before reporting the new call.
        for staleUUID in pendingCalls.keys where staleUUID != uuid {
            provider.reportCall(with: staleUUID, endedAt: nil, reason: .failed)
            pendingCalls.removeValue(forKey: staleUUID)
        }

        pendingCalls[uuid] = channelId
        activeCallUUID = uuid

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: channelId)
        update.localizedCallerName = callerName
        update.hasVideo = false

        // iOS 13+: must call reportNewIncomingCall synchronously within this delegate.
        // If we don't, iOS will terminate the app.
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil {
                // CallKit refused (e.g. Do Not Disturb, max calls reached).
                // Still must complete the PushKit handler.
                self?.pendingCalls.removeValue(forKey: uuid)
                if self?.activeCallUUID == uuid { self?.activeCallUUID = nil }
            }
            completion()
        }
    }

    // MARK: - CXProviderDelegate

    public func providerDidReset(_ provider: CXProvider) {
        pendingCalls.removeAll()
        activeCallUUID = nil
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let channelId = pendingCalls[action.callUUID] else {
            action.fail()
            return
        }
        trigger("call-answered", data: [
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
        if activeCallUUID == action.callUUID { activeCallUUID = nil }
    }

    // MARK: - Tauri commands

    /// Returns the last VoIP token received from PushKit, or null if none has
    /// arrived yet. JS calls this once at startup after registering the
    /// voip-token-updated listener to drain any token that arrived before the
    /// listener was ready.
    @objc public func getVoipToken(_ invoke: Invoke) {
        invoke.resolve(["token": cachedVoipToken as Any])
    }

    /// Called by the JS layer when the user leaves a call from within the app,
    /// so the system CallKit UI is dismissed.
    @objc public func endActiveCall(_ invoke: Invoke) {
        guard let uuid = activeCallUUID else {
            invoke.resolve()
            return
        }
        let transaction = CXTransaction(action: CXEndCallAction(call: uuid))
        callController.request(transaction) { [weak self] error in
            if error == nil {
                self?.pendingCalls.removeValue(forKey: uuid)
                self?.activeCallUUID = nil
            }
            invoke.resolve()
        }
    }
}

@_cdecl("init_plugin_call_kit")
func initPlugin() -> Plugin {
    return CallKitPlugin()
}
