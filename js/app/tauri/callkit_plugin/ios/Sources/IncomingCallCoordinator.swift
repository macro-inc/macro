import AVFAudio
import CallKit
import Foundation
import PushKit

/// PushKit + CallKit coordinator. Mutable state is main-queue only.
final class IncomingCallCoordinator: NSObject, CXProviderDelegate, PKPushRegistryDelegate, @unchecked Sendable {
    private let mediaSessionProvider: () -> NativeLiveKitCallSession
    private let onVoipTokenUpdated: (String) -> Void
    private let onCallAnswered: (String) -> Void
    private let onCallEnded: (String) -> Void

    private var provider: CXProvider!
    private let callController = CXCallController()
    private var registry: PKPushRegistry!

    private var pendingCalls: [UUID: String] = [:]
    private var pendingCallTokens: [UUID: PendingCallToken] = [:]
    private var activeCallUUID: UUID?
    private var cachedVoipToken: String?
    private var pendingAnsweredChannelId: String?

    init(
        mediaSession: @escaping () -> NativeLiveKitCallSession,
        onVoipTokenUpdated: @escaping (String) -> Void,
        onCallAnswered: @escaping (String) -> Void,
        onCallEnded: @escaping (String) -> Void
    ) {
        self.mediaSessionProvider = mediaSession
        self.onVoipTokenUpdated = onVoipTokenUpdated
        self.onCallAnswered = onCallAnswered
        self.onCallEnded = onCallEnded
    }

    func load() {
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

    func getVoipToken() -> String? {
        cachedVoipToken
    }

    func drainPendingAnsweredChannelId() -> String? {
        let channelId = pendingAnsweredChannelId
        pendingAnsweredChannelId = nil
        return channelId
    }

    func endActiveCall(completion: @escaping () -> Void) {
        guard let uuid = activeCallUUID else {
            completion()
            return
        }

        requestEndCall(uuid: uuid) { [weak self] error in
            guard let self else {
                completion()
                return
            }
            self.onMain {
                if error != nil {
                    self.clearCallState(uuid: uuid)
                    let mediaSession = self.mediaSessionProvider()
                    Task {
                        await mediaSession.disconnect()
                    }
                }
                completion()
            }
        }
    }

    func requestEndCall(uuid: UUID) {
        requestEndCall(uuid: uuid) { [weak self] error in
            guard let self, error != nil else { return }
            self.onMain {
                self.clearCallState(uuid: uuid)
                let mediaSession = self.mediaSessionProvider()
                Task {
                    await mediaSession.disconnect()
                }
            }
        }
    }

    private func requestEndCall(uuid: UUID, completion: @escaping (Error?) -> Void) {
        let transaction = CXTransaction(action: CXEndCallAction(call: uuid))
        callController.request(transaction) { error in
            if let error {
                print("[CallKit] CXEndCallAction request failed: \(error)")
            }
            completion(error)
        }
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02.2hhx", $0) }.joined()
        cachedVoipToken = token
        onVoipTokenUpdated(token)
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }

        let dict = payload.dictionaryPayload
        let channelId = dict["channelId"] as? String ?? ""
        let callerName = dict["callerName"] as? String ?? "Incoming Call"
        let callIdString = dict["callId"] as? String ?? ""
        let livekitServerUrl = dict["livekitServerUrl"] as? String
        let livekitToken = dict["livekitToken"] as? String

        guard let uuid = UUID(uuidString: callIdString) else {
            // PushKit requires every VoIP push to be reported to CallKit.
            let safePayloadKeys = dict.keys
                .compactMap { $0 as? String }
                .filter { $0 != "livekitServerUrl" && $0 != "livekitToken" }
                .sorted()
            print("[CallKit] Invalid callId '\(callIdString)' in VoIP payload; keys=\(safePayloadKeys)")
            let fallbackUUID = UUID()
            provider.reportNewIncomingCall(with: fallbackUUID, update: CXCallUpdate()) { [weak self] _ in
                self?.provider.reportCall(with: fallbackUUID, endedAt: nil, reason: .failed)
                completion()
            }
            return
        }

        // Copy keys before mutating; Dictionary.Keys is a live view.
        for staleUUID in Array(pendingCalls.keys) where staleUUID != uuid {
            provider.reportCall(with: staleUUID, endedAt: nil, reason: .failed)
            pendingCalls.removeValue(forKey: staleUUID)
            pendingCallTokens.removeValue(forKey: staleUUID)
        }

        pendingCalls[uuid] = channelId
        if let serverUrl = livekitServerUrl, let token = livekitToken {
            pendingCallTokens[uuid] = PendingCallToken(serverUrl: serverUrl, token: token)
        } else {
            pendingCallTokens.removeValue(forKey: uuid)
            print("[CallKit] VoIP payload missing native connection credentials; lock-screen answer will not connect natively")
        }
        activeCallUUID = uuid

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: channelId)
        update.localizedCallerName = callerName
        update.hasVideo = false

        // Must happen from the PushKit delegate; otherwise iOS can terminate us.
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil {
                self?.pendingCalls.removeValue(forKey: uuid)
                self?.pendingCallTokens.removeValue(forKey: uuid)
                if self?.activeCallUUID == uuid { self?.activeCallUUID = nil }
            }
            completion()
        }
    }

    func providerDidReset(_ provider: CXProvider) {
        pendingCalls.removeAll()
        pendingCallTokens.removeAll()
        activeCallUUID = nil
        pendingAnsweredChannelId = nil
        let mediaSession = mediaSessionProvider()
        Task {
            await mediaSession.disconnect()
        }
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let channelId = pendingCalls[action.callUUID] else {
            action.fail()
            return
        }

        let mediaSession = mediaSessionProvider()
        mediaSession.configureAudioSessionCategory()

        pendingAnsweredChannelId = channelId
        onCallAnswered(channelId)

        let answeredUUID = action.callUUID
        if let pending = pendingCallTokens[answeredUUID] {
            mediaSession.connect(
                uuid: answeredUUID,
                channelId: channelId,
                serverUrl: pending.serverUrl,
                token: pending.token
            )
        } else {
            print("[CallKit] No cached LiveKit token for answered call \(answeredUUID.uuidString); JS-driven join required")
        }

        // Keep activeCallUUID so JS can still request CXEndCallAction.
        pendingCalls.removeValue(forKey: answeredUUID)
        pendingCallTokens.removeValue(forKey: answeredUUID)

        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let callId = action.callUUID.uuidString
        onCallEnded(callId)

        let mediaSession = mediaSessionProvider()
        Task {
            await mediaSession.disconnect()
        }

        action.fulfill()
        clearCallState(uuid: action.callUUID)
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        mediaSessionProvider().activateAudioEngine()
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        mediaSessionProvider().deactivateAudioEngine()
    }

    private func clearCallState(uuid: UUID) {
        pendingCalls.removeValue(forKey: uuid)
        pendingCallTokens.removeValue(forKey: uuid)
        if activeCallUUID == uuid { activeCallUUID = nil }
        pendingAnsweredChannelId = nil
    }

    private func onMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread {
            block()
        } else {
            DispatchQueue.main.async(execute: block)
        }
    }
}
