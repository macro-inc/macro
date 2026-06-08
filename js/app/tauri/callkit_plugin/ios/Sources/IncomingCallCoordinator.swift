import AVFAudio
import CallKit
import Foundation
import PushKit

private let enableNativeLiveKitAnswer = true

/// PushKit + CallKit coordinator. Mutable state is main-queue only.
final class IncomingCallCoordinator: NSObject, CXProviderDelegate, PKPushRegistryDelegate, @unchecked Sendable {
    private let mediaSessionProvider: () -> NativeLiveKitCallSession
    private let onVoipTokenUpdated: (String) -> Void
    private let onCallAnswered: (String, Bool) -> Void
    private let onCallEnded: (String) -> Void

    private var provider: CXProvider!
    private var providerConfiguration: CXProviderConfiguration!
    private let callController = CXCallController()
    private var registry: PKPushRegistry!

    private var pendingCalls: [UUID: PendingCallInfo] = [:]
    private var pendingCallTokens: [UUID: PendingCallToken] = [:]
    private var activeCallUUID: UUID?
    private var activeNativeMediaUUID: UUID?
    private var isCallKitAudioSessionActive = false
    private var outgoingCallUUIDs: Set<UUID> = []
    private var reportedConnectedOutgoingCallUUIDs: Set<UUID> = []
    private var cachedVoipToken: String?
    private var pendingAnsweredCall: (channelId: String, nativeMedia: Bool)?

    init(
        mediaSession: @escaping () -> NativeLiveKitCallSession,
        onVoipTokenUpdated: @escaping (String) -> Void,
        onCallAnswered: @escaping (String, Bool) -> Void,
        onCallEnded: @escaping (String) -> Void
    ) {
        self.mediaSessionProvider = mediaSession
        self.onVoipTokenUpdated = onVoipTokenUpdated
        self.onCallAnswered = onCallAnswered
        self.onCallEnded = onCallEnded
    }

    func load() {
        print("[CallKit] Loading PushKit/CallKit coordinator")
        let config = makeProviderConfiguration()

        providerConfiguration = config
        provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: .main)

        registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        print("[CallKit] PushKit registry configured for VoIP pushes")
    }

    func getVoipToken() -> String? {
        cachedVoipToken
    }

    func drainPendingAnsweredCall() -> (channelId: String, nativeMedia: Bool)? {
        let answeredCall = pendingAnsweredCall
        pendingAnsweredCall = nil
        return answeredCall
    }

    func startOutgoingCall(
        uuid: UUID,
        channelId: String,
        channelName: String?,
        callerName: String?,
        serverUrl: String,
        token: String,
        completion: @escaping (Error?) -> Void
    ) {
        if let activeCallUUID, activeCallUUID != uuid {
            print("[CallKit] startOutgoingCall rejected; active call already exists activeUuid=\(activeCallUUID.uuidString) requestedUuid=\(uuid.uuidString)")
            completion(NSError(
                domain: "CallKitPlugin",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "A CallKit call is already active"]
            ))
            return
        }

        let title = channelName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayTitle = title?.isEmpty == false ? title : nil
        pendingCalls[uuid] = PendingCallInfo(
            channelId: channelId,
            channelName: displayTitle,
            callerName: callerName
        )
        pendingCallTokens[uuid] = PendingCallToken(serverUrl: serverUrl, token: token)
        activeCallUUID = uuid
        activeNativeMediaUUID = uuid
        outgoingCallUUIDs.insert(uuid)
        reportedConnectedOutgoingCallUUIDs.remove(uuid)
        mediaSessionProvider().setChannelTitle(displayTitle)
        activateNativeMediaAudioIfNeeded(reason: "outgoing call prepared")

        let handle = CXHandle(type: .generic, value: displayTitle ?? channelId)
        let action = CXStartCallAction(call: uuid, handle: handle)
        action.isVideo = true
        let transaction = CXTransaction(action: action)
        print("[CallKit] Requesting CXStartCallAction uuid=\(uuid.uuidString) channelId=\(channelId) channelName=\(displayTitle ?? "nil")")
        callController.request(transaction) { [weak self] error in
            DispatchQueue.main.async {
                if let error {
                    print("[CallKit] CXStartCallAction request failed uuid=\(uuid.uuidString) error=\(error)")
                    self?.clearCallState(uuid: uuid)
                } else {
                    print("[CallKit] CXStartCallAction request accepted uuid=\(uuid.uuidString)")
                }
                completion(error)
            }
        }
    }

    func reportNativeCallConnected(uuid: UUID) {
        guard activeNativeMediaUUID == uuid, outgoingCallUUIDs.contains(uuid) else { return }
        guard !reportedConnectedOutgoingCallUUIDs.contains(uuid) else { return }
        reportedConnectedOutgoingCallUUIDs.insert(uuid)
        print("[CallKit] Reporting outgoing call connected uuid=\(uuid.uuidString)")
        provider.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    func endActiveCall(completion: @escaping () -> Void) {
        guard let uuid = activeCallUUID else {
            print("[CallKit] endActiveCall requested with no active CallKit UUID")
            completion()
            return
        }

        print("[CallKit] endActiveCall requesting CXEndCallAction uuid=\(uuid.uuidString)")
        requestEndCall(uuid: uuid) { [weak self] error in
            guard let self else {
                completion()
                return
            }
            self.onMain {
                if error != nil {
                    print("[CallKit] CXEndCallAction failed; clearing local state uuid=\(uuid.uuidString)")
                    let shouldDisconnectNativeMedia = self.activeNativeMediaUUID == uuid
                    self.clearCallState(uuid: uuid)
                    if shouldDisconnectNativeMedia {
                        let mediaSession = self.mediaSessionProvider()
                        Task {
                            await mediaSession.disconnect()
                        }
                    }
                }
                completion()
            }
        }
    }

    func requestEndCall(uuid: UUID) {
        print("[CallKit] requestEndCall uuid=\(uuid.uuidString)")
        requestEndCall(uuid: uuid) { [weak self] error in
            guard let self, error != nil else { return }
            self.onMain {
                print("[CallKit] requestEndCall failed; disconnecting media session uuid=\(uuid.uuidString)")
                let shouldDisconnectNativeMedia = self.activeNativeMediaUUID == uuid
                self.clearCallState(uuid: uuid)
                if shouldDisconnectNativeMedia {
                    let mediaSession = self.mediaSessionProvider()
                    Task {
                        await mediaSession.disconnect()
                    }
                }
            }
        }
    }

    func handleApplicationWillTerminate() {
        guard let uuid = activeCallUUID else {
            print("[CallKit] Application terminating with no active CallKit call")
            return
        }

        print("[CallKit] Application terminating with active CallKit call uuid=\(uuid.uuidString)")
        let shouldDisconnectNativeMedia = activeNativeMediaUUID == uuid
        if shouldDisconnectNativeMedia {
            mediaSessionProvider().disconnectForAppTermination()
        }
        provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
        clearCallState(uuid: uuid)
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
        print("[CallKit] VoIP token updated byteLength=\(pushCredentials.token.count)")
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
        let channelName = dict["channelName"] as? String
        let callerName = dict["callerName"] as? String ?? "Incoming Call"
        let callIdString = dict["callId"] as? String ?? ""
        let livekitServerUrl = dict["livekitServerUrl"] as? String
        let livekitToken = dict["livekitToken"] as? String
        let hasNativeCredentials = livekitServerUrl != nil && livekitToken != nil
        print("[CallKit] Received VoIP push callId=\(callIdString) channelId=\(channelId) channelName=\(channelName ?? "nil") hasNativeCredentials=\(hasNativeCredentials)")

        guard let uuid = UUID(uuidString: callIdString) else {
            // PushKit requires every VoIP push to be reported to CallKit.
            let safePayloadKeys = dict.keys
                .compactMap { $0 as? String }
                .filter { $0 != "livekitServerUrl" && $0 != "livekitToken" }
                .sorted()
            print("[CallKit] Invalid callId '\(callIdString)' in VoIP payload; keys=\(safePayloadKeys)")
            let fallbackUUID = UUID()
            applyProviderConfiguration(reason: "invalid incoming call report")
            provider.reportNewIncomingCall(with: fallbackUUID, update: CXCallUpdate()) { [weak self] _ in
                self?.provider.reportCall(with: fallbackUUID, endedAt: nil, reason: .failed)
                completion()
            }
            return
        }

        // Copy keys before mutating; Dictionary.Keys is a live view.
        for staleUUID in Array(pendingCalls.keys) where staleUUID != uuid {
            print("[CallKit] Marking stale pending call failed uuid=\(staleUUID.uuidString)")
            provider.reportCall(with: staleUUID, endedAt: nil, reason: .failed)
            pendingCalls.removeValue(forKey: staleUUID)
            pendingCallTokens.removeValue(forKey: staleUUID)
        }

        pendingCalls[uuid] = PendingCallInfo(
            channelId: channelId,
            channelName: channelName,
            callerName: callerName
        )
        if let serverUrl = livekitServerUrl, let token = livekitToken {
            pendingCallTokens[uuid] = PendingCallToken(serverUrl: serverUrl, token: token)
        } else {
            pendingCallTokens.removeValue(forKey: uuid)
            print("[CallKit] VoIP payload missing native connection credentials; lock-screen answer will not connect natively")
        }
        activeCallUUID = uuid

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: channelName ?? channelId)
        update.localizedCallerName = callerName
        update.hasVideo = true

        // Must happen from the PushKit delegate; otherwise iOS can terminate us.
        applyProviderConfiguration(reason: "incoming call report")
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil {
                print("[CallKit] reportNewIncomingCall failed uuid=\(uuid.uuidString) error=\(String(describing: error))")
                self?.pendingCalls.removeValue(forKey: uuid)
                self?.pendingCallTokens.removeValue(forKey: uuid)
                if self?.activeCallUUID == uuid { self?.activeCallUUID = nil }
            } else {
                print("[CallKit] reportNewIncomingCall succeeded uuid=\(uuid.uuidString)")
            }
            completion()
        }
    }

    func providerDidReset(_ provider: CXProvider) {
        print("[CallKit] CXProvider reset; clearing CallKit and media state")
        pendingCalls.removeAll()
        pendingCallTokens.removeAll()
        activeCallUUID = nil
        isCallKitAudioSessionActive = false
        pendingAnsweredCall = nil
        outgoingCallUUIDs.removeAll()
        reportedConnectedOutgoingCallUUIDs.removeAll()
        if activeNativeMediaUUID != nil {
            activeNativeMediaUUID = nil
            let mediaSession = mediaSessionProvider()
            Task {
                await mediaSession.disconnect()
            }
        }
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        let uuid = action.callUUID
        print("[CallKit] CXStartCallAction received uuid=\(uuid.uuidString)")
        guard let pendingCall = pendingCalls[uuid],
              let pendingToken = pendingCallTokens[uuid] else {
            print("[CallKit] CXStartCallAction failed: no pending call/token uuid=\(uuid.uuidString)")
            action.fail()
            clearCallState(uuid: uuid)
            return
        }

        activeCallUUID = uuid
        activeNativeMediaUUID = uuid
        provider.reportOutgoingCall(with: uuid, startedConnectingAt: Date())
        action.fulfill()
        print("[CallKit] Fulfilled CXStartCallAction uuid=\(uuid.uuidString)")

        Task { @MainActor [weak self] in
            guard let self else { return }
            guard self.canStartNativeMediaConnect(uuid: uuid),
                  self.pendingCalls[uuid] != nil,
                  self.pendingCallTokens[uuid] != nil else {
                print("[CallKit] Skipping outgoing native LiveKit connect; call no longer active uuid=\(uuid.uuidString)")
                return
            }
            let mediaSession = self.mediaSessionProvider()
            mediaSession.setChannelTitle(pendingCall.channelName)
            print("[CallKit] Starting native LiveKit connect for outgoing call uuid=\(uuid.uuidString) channelId=\(pendingCall.channelId)")
            mediaSession.connect(
                uuid: uuid,
                channelId: pendingCall.channelId,
                serverUrl: pendingToken.serverUrl,
                token: pendingToken.token
            )
        }
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("[CallKit] CXAnswerCallAction received uuid=\(action.callUUID.uuidString)")
        guard let pendingCall = pendingCalls[action.callUUID] else {
            print("[CallKit] Answer failed: no pending channel for uuid=\(action.callUUID.uuidString)")
            action.fail()
            return
        }
        let channelId = pendingCall.channelId

        let answeredUUID = action.callUUID
        let pendingToken = pendingCallTokens[answeredUUID]
        let shouldConnectNatively = enableNativeLiveKitAnswer && pendingToken != nil
        if shouldConnectNatively {
            activeNativeMediaUUID = answeredUUID
            print("[CallKit] Scheduling native LiveKit connect for answered call uuid=\(answeredUUID.uuidString) channelId=\(channelId)")
            let mediaSession = mediaSessionProvider()
            mediaSession.setChannelTitle(pendingCall.channelName)
            mediaSession.prepareForCallKitAudio()
        } else if pendingCallTokens[answeredUUID] != nil {
            print("[CallKit] Native LiveKit answer disabled; JS-driven join required uuid=\(answeredUUID.uuidString)")
        } else {
            print("[CallKit] No cached LiveKit token for answered call \(answeredUUID.uuidString); JS-driven join required")
        }

        pendingAnsweredCall = (channelId: channelId, nativeMedia: shouldConnectNatively)

        // Keep activeCallUUID so JS can still request CXEndCallAction.
        pendingCalls.removeValue(forKey: answeredUUID)
        pendingCallTokens.removeValue(forKey: answeredUUID)

        print("[CallKit] Fulfilling CXAnswerCallAction uuid=\(answeredUUID.uuidString)")
        applyProviderConfiguration(reason: "answer action fulfillment")
        action.fulfill()
        print("[CallKit] Fulfilled CXAnswerCallAction uuid=\(answeredUUID.uuidString)")

        if shouldConnectNatively, let pendingToken {
            Task { @MainActor [weak self] in
                guard let self else { return }
                print("[CallKit] Native LiveKit connect task started uuid=\(answeredUUID.uuidString)")
                try? await Task.sleep(nanoseconds: 100_000_000)
                guard self.canStartNativeMediaConnect(uuid: answeredUUID) else {
                    print("[CallKit] Skipping answered native LiveKit connect; call no longer active uuid=\(answeredUUID.uuidString)")
                    return
                }
                let mediaSession = self.mediaSessionProvider()
                mediaSession.setChannelTitle(pendingCall.channelName)
                print("[CallKit] Starting native LiveKit connect uuid=\(answeredUUID.uuidString) channelId=\(channelId); audio remains gated until CallKit activation")
                mediaSession.connect(
                    uuid: answeredUUID,
                    channelId: channelId,
                    serverUrl: pendingToken.serverUrl,
                    token: pendingToken.token
                )
            }
        }

        DispatchQueue.main.async { [weak self] in
            print("[CallKit] Emitting call answered event after fulfill channelId=\(channelId) uuid=\(answeredUUID.uuidString) nativeMedia=\(shouldConnectNatively)")
            self?.onCallAnswered(channelId, shouldConnectNatively)
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let callId = action.callUUID.uuidString
        print("[CallKit] CXEndCallAction received uuid=\(callId)")
        onCallEnded(callId)

        if activeNativeMediaUUID == action.callUUID {
            let mediaSession = mediaSessionProvider()
            Task {
                await mediaSession.disconnect()
            }
        }

        action.fulfill()
        print("[CallKit] Fulfilled CXEndCallAction uuid=\(callId)")
        clearCallState(uuid: action.callUUID)
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        isCallKitAudioSessionActive = true
        guard activeNativeMediaUUID != nil else {
            print("[CallKit] AVAudioSession activated by CallKit; native media not active yet")
            return
        }
        print("[CallKit] AVAudioSession activated by CallKit for native media")
        mediaSessionProvider().activateAudioEngine(reason: "provider didActivate", audioSession: audioSession)
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        isCallKitAudioSessionActive = false
        guard activeNativeMediaUUID != nil else {
            print("[CallKit] AVAudioSession deactivated by CallKit; no native media session active")
            return
        }
        print("[CallKit] AVAudioSession deactivated by CallKit for native media")
        mediaSessionProvider().deactivateAudioEngine(audioSession: audioSession)
    }

    func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        let callUUID = (action as? CXCallAction)?.callUUID.uuidString ?? "nil"
        print("[CallKit] CXProvider timed out performing action=\(type(of: action)) uuid=\(callUUID)")
    }

    private func clearCallState(uuid: UUID) {
        print("[CallKit] Clearing call state uuid=\(uuid.uuidString)")
        pendingCalls.removeValue(forKey: uuid)
        pendingCallTokens.removeValue(forKey: uuid)
        if activeCallUUID == uuid { activeCallUUID = nil }
        if activeNativeMediaUUID == uuid { activeNativeMediaUUID = nil }
        outgoingCallUUIDs.remove(uuid)
        reportedConnectedOutgoingCallUUIDs.remove(uuid)
        pendingAnsweredCall = nil
    }

    private func activateNativeMediaAudioIfNeeded(reason: String) {
        guard activeNativeMediaUUID != nil else { return }
        guard isCallKitAudioSessionActive else {
            print("[CallKit] Native media waiting for CallKit AVAudioSession activation reason=\(reason)")
            return
        }
        print("[CallKit] Applying existing CallKit AVAudioSession activation to native media reason=\(reason) \(describeCurrentAudioRoute())")
        mediaSessionProvider().activateAudioEngine(reason: reason)
    }

    private func canStartNativeMediaConnect(uuid: UUID) -> Bool {
        activeCallUUID == uuid && activeNativeMediaUUID == uuid
    }

    private func makeProviderConfiguration() -> CXProviderConfiguration {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        return config
    }

    private func applyProviderConfiguration(reason: String) {
        let config = providerConfiguration ?? makeProviderConfiguration()
        providerConfiguration = config
        print("[CallKit] Applying CXProvider configuration reason=\(reason)")
        provider.configuration = config
    }

    private func describeCurrentAudioRoute() -> String {
        let session = AVAudioSession.sharedInstance()
        let inputs = session.currentRoute.inputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        let outputs = session.currentRoute.outputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        return "audioRoute(inputs=[\(inputs)], outputs=[\(outputs)])"
    }

    private func onMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread {
            block()
        } else {
            DispatchQueue.main.async(execute: block)
        }
    }
}
