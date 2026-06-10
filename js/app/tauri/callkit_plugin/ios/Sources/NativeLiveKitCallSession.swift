import AVFAudio
import AVFoundation
import Foundation
import LiveKit
import LiveKitWebRTC
import UIKit

/// Native LiveKit Room plus CallKit-owned audio-session integration.
///
/// Mutable call state (room, snapshot, pinned/speaking participants, display names) is
/// confined to the main thread. RoomDelegate callbacks arrive on LiveKit's background
/// queue and must hop to main before touching that state.
final class NativeLiveKitCallSession: NSObject, RoomDelegate, @unchecked Sendable {
    private let onSnapshotChanged: (ActiveCallSnapshot?) -> Void
    private let requestSystemEndCall: (UUID) -> Void
    private let onDrawerOpened: (String) -> Void
    private let onParticipantIdentitiesChanged: ([String]) -> Void
    private let videoOverlay: CallVideoOverlayController
    private lazy var pictureInPicture: CallPictureInPictureManaging = makeCallPictureInPictureController(
        sourceViewProvider: { [weak self] in
            self?.videoOverlay.pictureInPictureSourceView()
        },
        onRestore: { [weak self] in
            guard let self else { return }
            self.setVideoOverlayMode(.expanded)
            if let channelId = self.activeCall?.channelId {
                print("[CallKit] Picture in Picture restoring channelId=\(channelId)")
                self.onDrawerOpened(channelId)
            }
        }
    )

    private var room: Room?
    private var connectTask: Task<Void, Never>?
    private var activeCallUUID: UUID?
    private var activeCall: ActiveCallSnapshot?
    private var pinnedRemoteVideoParticipantId: String?
    private var speakingRemoteParticipantIds: [String] = []
    private var participantDisplayNamesByIdentity: [String: String] = [:]
    private var didPrepareAudio = false
    private var isCallKitAudioActive = false
    private var isActivatingAudioEngine = false
    private var desiredAudioMuted = false
    private let audioEngineLogger = CallKitAudioEngineLogger()
    private let audioRouteController = CallAudioRouteController()

    init(
        onSnapshotChanged: @escaping (ActiveCallSnapshot?) -> Void,
        requestSystemEndCall: @escaping (UUID) -> Void,
        onDrawerOpened: @escaping (String) -> Void,
        onParticipantIdentitiesChanged: @escaping ([String]) -> Void,
        videoOverlay: CallVideoOverlayController
    ) {
        self.onSnapshotChanged = onSnapshotChanged
        self.requestSystemEndCall = requestSystemEndCall
        self.onDrawerOpened = onDrawerOpened
        self.onParticipantIdentitiesChanged = onParticipantIdentitiesChanged
        self.videoOverlay = videoOverlay
        super.init()
        audioEngineLogger.desiredMutedProvider = { [weak self] in
            self?.desiredAudioMuted
        }
        configureLiveKitAudioForCallKit()
        videoOverlay.onToggleMicrophone = { [weak self] in
            self?.toggleAudioFromOverlay()
        }
        videoOverlay.onToggleSpeaker = { [weak self] in
            self?.toggleSpeakerFromOverlay()
        }
        videoOverlay.onToggleCamera = { [weak self] in
            self?.toggleVideoFromOverlay()
        }
        videoOverlay.onSwitchCamera = { [weak self] in
            self?.switchCamera()
        }
        videoOverlay.onEndCall = { [weak self] in
            self?.endCallFromOverlay()
        }
        videoOverlay.onSelectRemoteParticipant = { [weak self] participantId in
            self?.togglePinnedRemoteVideoParticipant(participantId)
        }
        videoOverlay.onOpenDrawerFromThumbnail = { [weak self] in
            guard let channelId = self?.activeCall?.channelId else { return }
            print("[CallKit] Native video overlay opened from thumbnail channelId=\(channelId)")
            self?.onDrawerOpened(channelId)
        }
        videoOverlay.onModeChanged = { [weak self] mode in
            print("[CallKit] Picture in Picture refreshing source for overlay mode=\(mode.rawValue)")
            self?.updateVideoOverlayMode(mode.rawValue)
            self?.pictureInPicture.prepare()
        }
        audioRouteController.onRouteChanged = { [weak self] route in
            guard let self else { return }
            self.videoOverlay.setAudioRoute(route)
            guard self.activeCallUUID != nil else { return }
            if self.isCallKitAudioActive, !AudioManager.shared.engineAvailability.isOutputAvailable {
                self.activateAudioEngine(reason: "audio route changed")
            } else if self.canEnableMicrophoneAudio() {
                self.enableMicrophoneAfterAudioActivationIfNeeded(reason: "audio route changed")
            }
        }
        audioRouteController.startObserving()
        pictureInPicture.prepare()
        print("[CallKit] NativeLiveKitCallSession initialized")
    }

    func prepareForCallKitAudio() {
        guard !didPrepareAudio else { return }
        didPrepareAudio = true

        print("[CallKit] Prepared LiveKit audio for CallKit-controlled activation")
        configureAudioSessionCategory(reason: "prepareForCallKitAudio")
    }

    private func configureLiveKitAudioForCallKit() {
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
        AudioManager.shared.audioSession.isAutomaticDeactivationEnabled = false
        AudioManager.shared.set(engineObservers: [
            AudioManager.shared.audioSession,
            audioEngineLogger,
            AudioManager.shared.mixer,
        ])
        do {
            try AudioManager.shared.setEngineAvailability(.none)
            print("[CallKit] Configured LiveKit audio for CallKit engine gating")
        } catch {
            print("[CallKit] Failed to gate LiveKit audio engine before CallKit activation: \(error)")
        }
    }

    func configureAudioSessionCategory(reason: String) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetoothHFP, .mixWithOthers]
            )
            try session.setPreferredIOBufferDuration(0.02)
            print("[CallKit] Configured AVAudioSession category for voice call reason=\(reason) \(describeAudioSession())")
            audioRouteController.emitCurrentRoute()
            if hasUsableAudioOutputRoute() {
                audioRouteController.defaultToSpeakerIfBuiltInRoute(reason: "audioSessionCategoryConfigured")
            } else {
                print("[CallKit] Skipping built-in speaker default because AVAudioSession route is not ready reason=\(reason) \(describeAudioSession())")
            }
        } catch {
            print("[CallKit] Failed to set audio session category reason=\(reason): \(error) \(describeAudioSession())")
        }
    }

    func activateAudioEngine(reason: String = "CallKit didActivate", audioSession: AVAudioSession? = nil) {
        guard !isActivatingAudioEngine else {
            print("[CallKit] Ignoring nested LiveKit audio engine activation reason=\(reason)")
            return
        }
        isActivatingAudioEngine = true
        defer { isActivatingAudioEngine = false }

        configureAudioSessionCategory(reason: reason)
        if !hasUsableAudioOutputRoute() {
            print("[CallKit] Activating LiveKit audio engine with empty AVAudioSession route reason=\(reason) \(describeAudioSession())")
        }
        do {
            if let audioSession {
                LKRTCAudioSession.sharedInstance().audioSessionDidActivate(audioSession)
                print("[CallKit] Notified LiveKit WebRTC audio session didActivate reason=\(reason)")
            }
            let availability = callKitAudioEngineAvailability()
            print("[CallKit] Enabling LiveKit audio engine after CallKit activation reason=\(reason) input=\(availability.isInputAvailable) output=\(availability.isOutputAvailable) \(describeAudioSession())")
            try AudioManager.shared.setEngineAvailability(availability)
            isCallKitAudioActive = true
            print("[CallKit] CallKit activated AVAudioSession; LiveKit audio engine available reason=\(reason) input=\(AudioManager.shared.engineAvailability.isInputAvailable) output=\(AudioManager.shared.engineAvailability.isOutputAvailable) running=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
            enableMicrophoneAfterAudioActivationIfNeeded(reason: reason)
        } catch {
            print("[CallKit] Failed to enable LiveKit audio engine after CallKit activation reason=\(reason): \(error) \(describeAudioSession())")
        }
    }

    func deactivateAudioEngine(audioSession: AVAudioSession? = nil) {
        isCallKitAudioActive = false
        do {
            if let audioSession {
                LKRTCAudioSession.sharedInstance().audioSessionDidDeactivate(audioSession)
                print("[CallKit] Notified LiveKit WebRTC audio session didDeactivate")
            }
            print("[CallKit] Disabling LiveKit audio engine after CallKit deactivation \(describeAudioSession())")
            try AudioManager.shared.setEngineAvailability(.none)
            print("[CallKit] CallKit deactivated AVAudioSession; LiveKit audio engine unavailable input=\(AudioManager.shared.engineAvailability.isInputAvailable) output=\(AudioManager.shared.engineAvailability.isOutputAvailable) running=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
        } catch {
            print("[CallKit] Failed to disable LiveKit audio engine after CallKit deactivation: \(error) \(describeAudioSession())")
        }
    }

    func currentSnapshot() -> ActiveCallSnapshot? {
        activeCall
    }

    func currentParticipantIdentities() -> [String] {
        guard let room else { return [] }
        return participantIdentities(from: room)
    }

    func connect(uuid: UUID, channelId: String, serverUrl: String, token: String) {
        print("[CallKit] Native LiveKit connect requested uuid=\(uuid.uuidString) channelId=\(channelId)")
        prepareForCallKitAudio()
        audioRouteController.prepareForCall()

        print("[CallKit] Creating LiveKit Room uuid=\(uuid.uuidString)")
        let newRoom = Room(
            delegate: self,
            roomOptions: RoomOptions(suspendLocalVideoTracksInBackground: false)
        )
        print("[CallKit] Created LiveKit Room uuid=\(uuid.uuidString)")

        activeCallUUID = uuid
        activeCall = ActiveCallSnapshot(
            channelId: channelId,
            callId: uuid.uuidString,
            connectionState: "connecting",
            isAudioMuted: false,
            isVideoMuted: true,
            videoOverlayMode: "hidden"
        )
        desiredAudioMuted = false
        pinnedRemoteVideoParticipantId = nil
        speakingRemoteParticipantIds = []
        videoOverlay.setAudioMuted(false)
        videoOverlay.setLocalVideoEnabled(false)
        emitSnapshot()

        connectTask?.cancel()
        let oldRoom = room
        room = newRoom

        connectTask = Task { [weak self, oldRoom, weak newRoom] in
            guard let self else { return }
            if let oldRoom {
                print("[CallKit] Disconnecting previous LiveKit room before new connect uuid=\(uuid.uuidString)")
                await oldRoom.disconnect()
                print("[CallKit] Previous LiveKit room disconnected uuid=\(uuid.uuidString)")
            }
            guard let newRoom else { return }
            do {
                print("[CallKit] Connecting LiveKit room uuid=\(uuid.uuidString)")
                try await newRoom.connect(url: serverUrl, token: token)
                let isCurrentRoom = await MainActor.run { () -> Bool in
                    guard self.activeCallUUID == uuid, self.room === newRoom else { return false }
                    print("[CallKit] LiveKit room connected uuid=\(uuid.uuidString) roomSid=\(self.describeOptional(newRoom.sid)) remoteCount=\(newRoom.remoteParticipants.count)")
                    print("[CallKit] LiveKit local participant \(self.describeParticipant(newRoom.localParticipant))")
                    for participant in newRoom.remoteParticipants.values {
                        print("[CallKit] LiveKit existing remote participant \(self.describeParticipant(participant))")
                    }
                    self.emitParticipantIdentities(from: newRoom)
                    self.videoOverlay.setLocalParticipantTitle(self.displayTitle(newRoom.localParticipant))
                    self.videoOverlay.presentForActiveCallIfNeeded()
                    self.rebuildRemoteVideoLayout(from: newRoom)
                    return true
                }
                guard isCurrentRoom else {
                    print("[CallKit] Ignoring LiveKit connect completion for stale room uuid=\(uuid.uuidString)")
                    return
                }
            } catch is CancellationError {
                print("[CallKit] LiveKit connect task cancelled uuid=\(uuid.uuidString)")
                return
            } catch {
                print("[CallKit] Failed to connect LiveKit room: \(error)")
                DispatchQueue.main.async { [weak self, weak newRoom] in
                    guard let self, self.activeCallUUID == uuid, self.room === newRoom else { return }
                    self.requestSystemEndCall(uuid)
                }
                return
            }

            do {
                guard await self.ensureMicrophonePermission(uuid: uuid) else {
                    self.updateAudioMuted(true, room: newRoom, uuid: uuid)
                    return
                }

                print("[CallKit] Enabling LiveKit microphone uuid=\(uuid.uuidString) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) callKitAudioActive=\(self.isCallKitAudioActive) \(self.describeAudioSession())")
                guard self.canEnableMicrophoneAudio() else {
                    print("[CallKit] Deferring LiveKit microphone enable until CallKit audio engine is ready uuid=\(uuid.uuidString) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) callKitAudioActive=\(self.isCallKitAudioActive) \(self.describeAudioSession())")
                    return
                }
                let microphoneWarning = Task {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if !Task.isCancelled {
                        print("[CallKit] Still waiting for LiveKit microphone enable uuid=\(uuid.uuidString) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(self.describeAudioSession())")
                    }
                }
                defer { microphoneWarning.cancel() }
                try await newRoom.localParticipant.setMicrophone(enabled: true)
                self.updateAudioMuted(false, room: newRoom, uuid: uuid)
                print("[CallKit] LiveKit microphone enabled uuid=\(uuid.uuidString) engineRunning=\(AudioManager.shared.isEngineRunning) \(self.describeAudioSession())")
            } catch is CancellationError {
                print("[CallKit] LiveKit microphone enable cancelled uuid=\(uuid.uuidString)")
                return
            } catch {
                print("[CallKit] Failed to enable LiveKit microphone; keeping room connected uuid=\(uuid.uuidString) error=\(error) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) callKitAudioActive=\(self.isCallKitAudioActive) \(self.describeAudioSession())")
                self.updateAudioMuted(true, room: newRoom, uuid: uuid)
            }
        }
    }

    func disconnect() async {
        print("[CallKit] Native LiveKit disconnect requested")
        let toDisconnect: Room? = await MainActor.run {
            self.clearNativeCallState(deactivateAudio: true)
        }

        if let toDisconnect {
            await toDisconnect.disconnect()
            print("[CallKit] Native LiveKit room disconnected")
        } else {
            print("[CallKit] Native LiveKit disconnect had no active room")
        }
    }

    func disconnectForAppTermination() {
        print("[CallKit] Native LiveKit app termination disconnect requested")
        let backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "CallKitLiveKitDisconnectOnTerminate") {
            print("[CallKit] Native LiveKit app termination disconnect background task expired")
        }

        Task { @MainActor [weak self] in
            guard let self else {
                if backgroundTask != .invalid {
                    UIApplication.shared.endBackgroundTask(backgroundTask)
                }
                return
            }

            let toDisconnect = self.clearNativeCallState(deactivateAudio: true)
            if let toDisconnect {
                await toDisconnect.disconnect()
                print("[CallKit] Native LiveKit room disconnected for app termination")
            } else {
                print("[CallKit] Native LiveKit app termination disconnect had no active room")
            }

            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
            }
        }
    }

    func setAudioMuted(_ muted: Bool) {
        guard let room, let uuid = activeCallUUID else {
            print("[CallKit] setAudioMuted ignored; no active native room muted=\(muted)")
            return
        }

        desiredAudioMuted = muted
        print("[CallKit] Native LiveKit desired microphone muted=\(muted) uuid=\(uuid.uuidString) currentSnapshotMuted=\(activeCall?.isAudioMuted.description ?? "nil")")

        Task { [weak self, weak room] in
            guard let self, let room else { return }

            do {
                if muted {
                    print("[CallKit] Applying native LiveKit microphone muted=true uuid=\(uuid.uuidString) desiredMuted=\(self.desiredAudioMuted)")
                    try await room.localParticipant.setMicrophone(enabled: false)
                    self.updateAudioMuted(true, room: room, uuid: uuid)
                    print("[CallKit] Native LiveKit microphone muted uuid=\(uuid.uuidString) desiredMuted=\(self.desiredAudioMuted)")
                    return
                }

                guard await self.ensureMicrophonePermission(uuid: uuid) else {
                    self.updateAudioMuted(true, room: room, uuid: uuid)
                    return
                }

                print("[CallKit] Applying native LiveKit microphone muted=false uuid=\(uuid.uuidString) desiredMuted=\(self.desiredAudioMuted) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
                guard self.canEnableMicrophoneAudio() else {
                    print("[CallKit] Deferring native LiveKit microphone unmute until CallKit audio engine is ready uuid=\(uuid.uuidString) desiredMuted=\(self.desiredAudioMuted) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(self.describeAudioSession())")
                    return
                }
                try await room.localParticipant.setMicrophone(enabled: true)
                self.updateAudioMuted(false, room: room, uuid: uuid)
                print("[CallKit] Native LiveKit microphone unmuted uuid=\(uuid.uuidString) desiredMuted=\(self.desiredAudioMuted)")
            } catch {
                print("[CallKit] Failed to set native LiveKit microphone muted=\(muted) uuid=\(uuid.uuidString) desiredMuted=\(self.desiredAudioMuted): \(error)")
                self.updateAudioMuted(true, room: room, uuid: uuid)
            }
        }
    }

    func setParticipantDisplayName(identity: String, displayName: String?) {
        let trimmedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedIdentity = normalizedParticipantIdentity(trimmedIdentity)
        let trimmedName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedName, !trimmedName.isEmpty {
            participantDisplayNamesByIdentity[trimmedIdentity] = trimmedName
            participantDisplayNamesByIdentity[normalizedIdentity] = trimmedName
        } else {
            participantDisplayNamesByIdentity.removeValue(forKey: trimmedIdentity)
            participantDisplayNamesByIdentity.removeValue(forKey: normalizedIdentity)
        }

        print("[CallKit] Native LiveKit participant display name set identity=\(trimmedIdentity) normalizedIdentity=\(normalizedIdentity) displayName=\(participantDisplayNamesByIdentity[normalizedIdentity] ?? "nil")")
        if let room {
            videoOverlay.setLocalParticipantTitle(displayTitle(room.localParticipant))
            rebuildRemoteVideoLayout(from: room)
        }
    }

    func setChannelTitle(_ title: String?) {
        videoOverlay.setChannelTitle(title)
    }

    func setVideoEnabled(_ enabled: Bool) {
        guard let room, let uuid = activeCallUUID else {
            print("[CallKit] setVideoEnabled ignored; no active native room enabled=\(enabled)")
            return
        }

        Task { [weak self, weak room] in
            guard let self, let room else { return }
            if enabled {
                guard await self.ensureCameraPermission(uuid: uuid) else {
                    self.updateVideoMuted(true, overlayMode: self.activeCall?.videoOverlayMode)
                    return
                }
            }

            do {
                print("[CallKit] Setting native LiveKit camera enabled=\(enabled) uuid=\(uuid.uuidString)")
                try await room.localParticipant.setCamera(enabled: enabled)
                if enabled {
                    self.enableMultitaskingCameraAccessIfSupported(room: room, uuid: uuid)
                    await MainActor.run {
                        self.videoOverlay.setLocalVideoTrack(room.localParticipant.firstCameraVideoTrack)
                        self.rebuildRemoteVideoLayout(from: room)
                    }
                    self.setVideoOverlayMode(.expanded)
                } else {
                    await MainActor.run {
                        self.videoOverlay.setLocalVideoTrack(nil)
                        self.rebuildRemoteVideoLayout(from: room)
                    }
                }
                self.updateVideoMuted(!enabled, overlayMode: enabled ? "expanded" : self.activeCall?.videoOverlayMode)
                print("[CallKit] Native LiveKit camera set enabled=\(enabled) uuid=\(uuid.uuidString)")
            } catch {
                print("[CallKit] Failed to set native LiveKit camera enabled=\(enabled) uuid=\(uuid.uuidString): \(error)")
                self.updateVideoMuted(true, overlayMode: self.activeCall?.videoOverlayMode)
            }
        }
    }

    func setVideoOverlayMode(_ mode: CallVideoOverlayMode) {
        videoOverlay.setMode(mode)
    }

    private func toggleVideoFromOverlay() {
        let enabled = activeCall?.isVideoMuted ?? true
        print("[CallKit] Native video overlay requested camera enabled=\(enabled)")
        setVideoEnabled(enabled)
    }

    private func toggleAudioFromOverlay() {
        let muted = !(activeCall?.isAudioMuted ?? false)
        print("[CallKit] Native video overlay requested microphone muted=\(muted)")
        setAudioMuted(muted)
    }

    private func toggleSpeakerFromOverlay() {
        let currentOutput = audioRouteController.currentRouteSnapshot().output
        let enableSpeaker = currentOutput != .speaker
        print("[CallKit] Native video overlay requested speaker enabled=\(enableSpeaker) currentOutput=\(currentOutput.rawValue)")
        audioRouteController.setSpeakerEnabled(enableSpeaker)
    }

    private func endCallFromOverlay() {
        guard let uuid = activeCallUUID else {
            print("[CallKit] Native video overlay end call ignored; no active call")
            return
        }

        print("[CallKit] Native video overlay requesting CallKit end uuid=\(uuid.uuidString)")
        requestSystemEndCall(uuid)
    }

    private func togglePinnedRemoteVideoParticipant(_ participantId: String) {
        pinnedRemoteVideoParticipantId = pinnedRemoteVideoParticipantId == participantId ? nil : participantId
        print("[CallKit] Native video overlay pinned remote participant=\(pinnedRemoteVideoParticipantId ?? "nil")")
        if let room {
            rebuildRemoteVideoLayout(from: room)
        }
    }

    func switchCamera() {
        guard let room, let uuid = activeCallUUID else {
            print("[CallKit] switchCamera ignored; no active native room")
            return
        }

        Task { [weak room] in
            guard
                let track = room?.localParticipant.firstCameraVideoTrack as? LocalVideoTrack,
                let capturer = track.capturer as? CameraCapturer
            else {
                print("[CallKit] switchCamera ignored; no active local camera track uuid=\(uuid.uuidString)")
                return
            }

            do {
                _ = try await capturer.switchCameraPosition()
                print("[CallKit] Native LiveKit camera switched uuid=\(uuid.uuidString)")
            } catch {
                print("[CallKit] Failed to switch native LiveKit camera uuid=\(uuid.uuidString): \(error)")
            }
        }
    }

    func room(
        _ room: Room,
        didUpdateConnectionState connectionState: ConnectionState,
        from oldConnectionState: ConnectionState
    ) {
        let stateString = describe(connectionState)
        print("[CallKit] LiveKit connection state changed \(describe(oldConnectionState)) -> \(stateString)")
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.room === room else { return }

            if connectionState == .disconnected {
                if let uuid = self.activeCallUUID {
                    self.requestSystemEndCall(uuid)
                }
                _ = self.clearNativeCallState(deactivateAudio: true)
                return
            }

            if var snapshot = self.activeCall {
                snapshot.connectionState = stateString
                self.activeCall = snapshot
                self.emitSnapshot()
            }
        }
    }

    func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        print("[CallKit] LiveKit delegate didFailToConnect error=\(String(describing: error))")
    }

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        print("[CallKit] LiveKit delegate didDisconnect error=\(String(describing: error))")
    }

    func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        print("[CallKit] LiveKit reconnect started mode=\(reconnectMode)")
    }

    func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) {
        print("[CallKit] LiveKit reconnect completed mode=\(reconnectMode)")
    }

    func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.room === room else { return }
            print("[CallKit] LiveKit remote participant connected \(self.describeParticipant(participant)) remoteCount=\(room.remoteParticipants.count)")
            self.emitParticipantIdentities(from: room)
            self.rebuildRemoteVideoLayout(from: room)
        }
    }

    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.room === room else { return }
            print("[CallKit] LiveKit remote participant disconnected \(self.describeParticipant(participant)) remoteCount=\(room.remoteParticipants.count)")
            let id = self.participantId(participant)
            if self.pinnedRemoteVideoParticipantId == id {
                self.pinnedRemoteVideoParticipantId = nil
            }
            self.speakingRemoteParticipantIds.removeAll { $0 == id }
            self.emitParticipantIdentities(from: room)
            self.rebuildRemoteVideoLayout(from: room)
        }
    }

    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.room === room else { return }
            self.speakingRemoteParticipantIds = participants
                .filter { $0 is RemoteParticipant && !self.isAgentParticipant($0) }
                .map { self.participantId($0) }
            print("[CallKit] LiveKit speaking participants updated participants=\(participants.map { self.describeParticipant($0) })")
            self.rebuildRemoteVideoLayout(from: room)
        }
    }

    func room(_ room: Room, participant: Participant, didUpdateState state: ParticipantState) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            print("[CallKit] LiveKit participant state updated \(self.describeParticipant(participant)) state=\(state)")
        }
    }

    func room(_ room: Room, participant: Participant, didUpdateConnectionQuality quality: ConnectionQuality) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            print("[CallKit] LiveKit participant quality updated \(self.describeParticipant(participant)) quality=\(quality)")
        }
    }

    func room(_ room: Room, participant: LocalParticipant, didPublishTrack publication: LocalTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            print("[CallKit] LiveKit local track published \(self.describeParticipant(participant)) \(self.describe(publication))")
            guard self.isCurrentRoom(room) else {
                print("[CallKit] Ignoring local track publish from stale room")
                return
            }
            if let track = publication.track as? VideoTrack, publication.source == .camera {
                self.enableMultitaskingCameraAccessIfSupported(room: room, uuid: self.activeCallUUID)
                self.videoOverlay.setLocalVideoTrack(track)
                self.rebuildRemoteVideoLayout(from: room)
                self.updateVideoMuted(false, overlayMode: "expanded")
            }
        }
    }

    func room(_ room: Room, participant: LocalParticipant, didUnpublishTrack publication: LocalTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            print("[CallKit] LiveKit local track unpublished \(self.describeParticipant(participant)) \(self.describe(publication))")
            guard self.isCurrentRoom(room) else {
                print("[CallKit] Ignoring local track unpublish from stale room")
                return
            }
            if publication.source == .camera {
                self.videoOverlay.setLocalVideoTrack(nil)
                self.rebuildRemoteVideoLayout(from: room)
                self.updateVideoMuted(true, overlayMode: self.activeCall?.videoOverlayMode)
            }
        }
    }

    func room(_ room: Room, participant: LocalParticipant, remoteDidSubscribeTrack publication: LocalTrackPublication) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            print("[CallKit] LiveKit remote subscribed to local track \(self.describeParticipant(participant)) \(self.describe(publication))")
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            print("[CallKit] LiveKit remote track published \(self.describeParticipant(participant)) \(self.describe(publication))")
            if publication.kind == .video {
                self.rebuildRemoteVideoLayout(from: room)
            }
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            print("[CallKit] LiveKit remote track subscribed \(self.describeParticipant(participant)) \(self.describe(publication))")
            if publication.track is VideoTrack, self.isRemoteVideoSource(publication.source) {
                self.rebuildRemoteVideoLayout(from: room)
                self.setVideoOverlayMode(.expanded)
            }
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            print("[CallKit] LiveKit remote track unsubscribed \(self.describeParticipant(participant)) \(self.describe(publication))")
            if self.isRemoteVideoSource(publication.source) {
                self.rebuildRemoteVideoLayout(from: room)
            }
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didFailToSubscribeTrackWithSid trackSid: Track.Sid, error: LiveKitError) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            print("[CallKit] LiveKit remote track subscribe failed \(self.describeParticipant(participant)) trackSid=\(trackSid) error=\(error)")
        }
    }

    func room(
        _ room: Room,
        participant: Participant,
        trackPublication: TrackPublication,
        didUpdateIsMuted isMuted: Bool
    ) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            print("[CallKit] LiveKit track mute updated \(self.describeParticipant(participant)) \(self.describe(trackPublication)) muted=\(isMuted)")
            if participant is RemoteParticipant, trackPublication.kind == .video {
                self.rebuildRemoteVideoLayout(from: room)
            }
        }
    }

    private func describe(_ state: ConnectionState) -> String {
        switch state {
        case .disconnected: return "disconnected"
        case .connecting: return "connecting"
        case .reconnecting: return "reconnecting"
        case .connected: return "connected"
        case .disconnecting: return "disconnecting"
        @unknown default: return "disconnected"
        }
    }

    private func describe(_ publication: TrackPublication) -> String {
        "trackSid=\(publication.sid) source=\(publication.source) kind=\(publication.kind) muted=\(publication.isMuted)"
    }

    private func rebuildRemoteVideoLayout(from room: Room) {
        guard isCurrentRoom(room) else {
            print("[CallKit] Ignoring remote video layout rebuild from stale room")
            return
        }

        let participants = room.remoteParticipants.values.filter { !isAgentParticipant($0) }.map { participant -> NativeVideoParticipant in
            let id = participantId(participant)
            if let track = participant.firstScreenShareVideoTrack {
                return NativeVideoParticipant(
                    id: id,
                    title: displayTitle(participant),
                    track: track,
                    isSpeaking: speakingRemoteParticipantIds.contains(id),
                    isPinned: pinnedRemoteVideoParticipantId == id,
                    isScreenShare: true
                )
            }

            return NativeVideoParticipant(
                id: id,
                title: displayTitle(participant),
                track: participant.firstCameraVideoTrack,
                isSpeaking: speakingRemoteParticipantIds.contains(id),
                isPinned: pinnedRemoteVideoParticipantId == id,
                isScreenShare: false
            )
        }

        if let pinnedId = pinnedRemoteVideoParticipantId,
           !participants.contains(where: { $0.id == pinnedId }) {
            pinnedRemoteVideoParticipantId = nil
        }

        let primary = participants.first(where: { $0.isScreenShare })
            ?? participants.first(where: { $0.id == pinnedRemoteVideoParticipantId })
            ?? speakingRemoteParticipantIds.compactMap { speakingId in
                participants.first(where: { $0.id == speakingId })
            }.first
            ?? participants.first

        videoOverlay.setRemoteVideoParticipants(participants, primaryId: primary?.id)
        updatePictureInPicture(from: room, primary: primary)
        print("[CallKit] Rebuilt remote video layout participants=\(participants.map { "\($0.id):\($0.title)" }) primary=\(primary?.id ?? "nil") pinned=\(pinnedRemoteVideoParticipantId ?? "nil")")
    }

    private func updatePictureInPicture(from room: Room, primary: NativeVideoParticipant?) {
        let localTrack = room.localParticipant.firstCameraVideoTrack
        print("[CallKit] Picture in Picture selected localTitle=\(displayTitle(room.localParticipant)) localTrack=\(localTrack != nil) primaryParticipant=\(primary?.id ?? "nil") remoteTitle=\(primary?.title ?? "nil") remoteTrack=\(primary?.track != nil)")
        pictureInPicture.setParticipants(
            localTitle: displayTitle(room.localParticipant),
            localTrack: localTrack,
            remoteTitle: primary?.title,
            remoteTrack: primary?.track
        )
    }

    private func enableMultitaskingCameraAccessIfSupported(room: Room, uuid: UUID?) {
        guard #available(iOS 16.0, *) else {
            print("[CallKit] Multitasking camera access unavailable before iOS 16 uuid=\(uuid?.uuidString ?? "nil")")
            return
        }
        guard
            let track = room.localParticipant.firstCameraVideoTrack as? LocalVideoTrack,
            let capturer = track.capturer as? CameraCapturer
        else {
            print("[CallKit] Multitasking camera access skipped; no local camera capturer uuid=\(uuid?.uuidString ?? "nil")")
            return
        }
        guard capturer.isMultitaskingAccessSupported else {
            print("[CallKit] Multitasking camera access not supported uuid=\(uuid?.uuidString ?? "nil")")
            return
        }

        capturer.isMultitaskingAccessEnabled = true
        print("[CallKit] Multitasking camera access enabled uuid=\(uuid?.uuidString ?? "nil") enabled=\(capturer.isMultitaskingAccessEnabled)")
    }

    private func emitParticipantIdentities(from room: Room) {
        guard isCurrentRoom(room) else {
            print("[CallKit] Ignoring participant identity emit from stale room")
            return
        }
        onParticipantIdentitiesChanged(participantIdentities(from: room))
    }

    private func participantIdentities(from room: Room) -> [String] {
        let identities = ([room.localParticipant.identity?.stringValue]
            + room.remoteParticipants.values
                .filter { !isAgentParticipant($0) }
                .map { $0.identity?.stringValue })
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return Array(Set(identities)).sorted()
    }

    private func isAgentParticipant(_ participant: Participant) -> Bool {
        participant.identity?.stringValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .hasPrefix("agent-") == true
    }

    private func isCurrentRoom(_ room: Room) -> Bool {
        self.room === room && activeCall != nil
    }

    private func isRemoteVideoSource(_ source: Track.Source) -> Bool {
        source == .camera || source == .screenShareVideo
    }

    private func participantId(_ participant: Participant) -> String {
        participant.sid?.stringValue
            ?? participant.identity?.stringValue
            ?? "\(ObjectIdentifier(participant).hashValue)"
    }

    private func displayTitle(_ participant: Participant) -> String {
        if let identity = participant.identity?.stringValue {
            let trimmedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
            if let displayName = participantDisplayNamesByIdentity[trimmedIdentity],
               !displayName.isEmpty {
                return displayName
            }
            let normalizedIdentity = normalizedParticipantIdentity(trimmedIdentity)
            if let displayName = participantDisplayNamesByIdentity[normalizedIdentity],
               !displayName.isEmpty {
                return displayName
            }
        }
        if let name = participant.name, !name.isEmpty {
            return name
        }
        if let identity = participant.identity?.stringValue, !identity.isEmpty {
            return fallbackParticipantName(identity: identity)
        }
        return "Participant"
    }

    private func normalizedParticipantIdentity(_ identity: String) -> String {
        identity.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func describeParticipant(_ participant: Participant) -> String {
        "participantSid=\(describeOptional(participant.sid)) identity=\(describeOptional(participant.identity?.stringValue)) name=\(describeOptional(participant.name)) title=\(displayTitle(participant))"
    }

    private func fallbackParticipantName(identity: String) -> String {
        let trimmedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
        let emailOrIdentity = trimmedIdentity.hasPrefix("macro|")
            ? String(trimmedIdentity.dropFirst("macro|".count))
            : trimmedIdentity
        if let localPart = emailOrIdentity.split(separator: "@").first, !localPart.isEmpty {
            return String(localPart)
        }
        return trimmedIdentity.isEmpty ? "Participant" : trimmedIdentity
    }

    private func ensureMicrophonePermission(uuid: UUID) async -> Bool {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            print("[CallKit] Microphone permission granted uuid=\(uuid.uuidString)")
            if isCallKitAudioActive && !AudioManager.shared.engineAvailability.isInputAvailable {
                do {
                    try AudioManager.shared.setEngineAvailability(.default)
                    print("[CallKit] Restored LiveKit input availability after microphone grant uuid=\(uuid.uuidString)")
                } catch {
                    print("[CallKit] Failed to restore LiveKit input availability after microphone grant uuid=\(uuid.uuidString): \(error)")
                }
            }
            return true
        case .denied:
            setOutputOnlyAvailabilityIfNeeded(uuid: uuid)
            print("[CallKit] Microphone permission denied uuid=\(uuid.uuidString); keeping native room connected muted")
            return false
        case .undetermined:
            print("[CallKit] Microphone permission undetermined uuid=\(uuid.uuidString); requesting permission")
            let granted = await withCheckedContinuation { continuation in
                session.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
            print("[CallKit] Microphone permission request completed uuid=\(uuid.uuidString) granted=\(granted)")
            if granted, isCallKitAudioActive {
                do {
                    try AudioManager.shared.setEngineAvailability(.default)
                    print("[CallKit] Enabled LiveKit input availability after microphone permission request uuid=\(uuid.uuidString)")
                } catch {
                    print("[CallKit] Failed to enable LiveKit input availability after microphone permission request uuid=\(uuid.uuidString): \(error)")
                }
            } else if !granted {
                setOutputOnlyAvailabilityIfNeeded(uuid: uuid)
            }
            return granted
        @unknown default:
            setOutputOnlyAvailabilityIfNeeded(uuid: uuid)
            print("[CallKit] Microphone permission unknown uuid=\(uuid.uuidString); keeping native room connected muted")
            return false
        }
    }

    private func ensureCameraPermission(uuid: UUID) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            print("[CallKit] Camera permission granted uuid=\(uuid.uuidString)")
            return true
        case .denied, .restricted:
            print("[CallKit] Camera permission denied uuid=\(uuid.uuidString)")
            return false
        case .notDetermined:
            print("[CallKit] Camera permission undetermined uuid=\(uuid.uuidString); requesting permission")
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            print("[CallKit] Camera permission request completed uuid=\(uuid.uuidString) granted=\(granted)")
            return granted
        @unknown default:
            print("[CallKit] Camera permission unknown uuid=\(uuid.uuidString)")
            return false
        }
    }

    private func callKitAudioEngineAvailability() -> AudioEngineAvailability {
        if AVAudioSession.sharedInstance().recordPermission == .denied {
            return AudioEngineAvailability(isInputAvailable: false, isOutputAvailable: true)
        }
        return .default
    }

    private func hasUsableAudioOutputRoute() -> Bool {
        !AVAudioSession.sharedInstance().currentRoute.outputs.isEmpty
    }

    private func canEnableMicrophoneAudio() -> Bool {
        isCallKitAudioActive
            && AudioManager.shared.engineAvailability.isInputAvailable
    }

    private func enableMicrophoneAfterAudioActivationIfNeeded(reason: String) {
        guard !desiredAudioMuted else { return }
        guard let room, let uuid = activeCallUUID else { return }
        guard activeCall?.connectionState == "connected" else { return }
        guard canEnableMicrophoneAudio() else {
            print("[CallKit] Waiting to restore LiveKit microphone after audio activation reason=\(reason) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
            return
        }

        Task { [weak self, weak room] in
            guard let self, let room else { return }
            guard self.activeCallUUID == uuid, self.room === room, !self.desiredAudioMuted else { return }
            do {
                print("[CallKit] Restoring LiveKit microphone after audio activation reason=\(reason) uuid=\(uuid.uuidString) engineRunning=\(AudioManager.shared.isEngineRunning) \(self.describeAudioSession())")
                try await room.localParticipant.setMicrophone(enabled: true)
                self.updateAudioMuted(false, room: room, uuid: uuid)
                print("[CallKit] Restored LiveKit microphone after audio activation reason=\(reason) uuid=\(uuid.uuidString)")
            } catch {
                print("[CallKit] Failed to restore LiveKit microphone after audio activation reason=\(reason) uuid=\(uuid.uuidString): \(error) \(self.describeAudioSession())")
            }
        }
    }

    private func setOutputOnlyAvailabilityIfNeeded(uuid: UUID) {
        guard isCallKitAudioActive else { return }
        do {
            try AudioManager.shared.setEngineAvailability(
                AudioEngineAvailability(isInputAvailable: false, isOutputAvailable: true)
            )
            print("[CallKit] Set LiveKit audio engine to output-only uuid=\(uuid.uuidString) running=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
        } catch {
            print("[CallKit] Failed to set LiveKit audio engine to output-only uuid=\(uuid.uuidString): \(error) \(describeAudioSession())")
        }
    }

    private func describeAudioSession() -> String {
        let session = AVAudioSession.sharedInstance()
        let inputs = session.currentRoute.inputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        let outputs = session.currentRoute.outputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        return "audioSession(category=\(session.category.rawValue), mode=\(session.mode.rawValue), activeSecondaryAudioSilenced=\(session.secondaryAudioShouldBeSilencedHint), recordPermission=\(describe(session.recordPermission)), sampleRate=\(session.sampleRate), ioBuffer=\(session.ioBufferDuration), inputs=[\(inputs)], outputs=[\(outputs)])"
    }

    private func describe(_ permission: AVAudioSession.RecordPermission) -> String {
        switch permission {
        case .granted: return "granted"
        case .denied: return "denied"
        case .undetermined: return "undetermined"
        @unknown default: return "unknown"
        }
    }

    private func describeOptional<T>(_ value: T?) -> String {
        value.map { "\($0)" } ?? "nil"
    }

    private func updateVideoMuted(_ isMuted: Bool, overlayMode: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, var snapshot = self.activeCall else { return }
            snapshot.isVideoMuted = isMuted
            if let overlayMode {
                snapshot.videoOverlayMode = overlayMode
            }
            self.activeCall = snapshot
            self.videoOverlay.setLocalVideoEnabled(!isMuted)
            self.emitSnapshot()
        }
    }

    private func updateAudioMuted(_ isMuted: Bool, room: Room, uuid: UUID) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.activeCallUUID == uuid, self.room === room, var snapshot = self.activeCall else { return }
            let previousMuted = snapshot.isAudioMuted
            snapshot.isAudioMuted = isMuted
            self.desiredAudioMuted = isMuted
            self.activeCall = snapshot
            print("[CallKit] Native LiveKit microphone state updated uuid=\(uuid.uuidString) previousMuted=\(previousMuted) actualMuted=\(isMuted) desiredMuted=\(self.desiredAudioMuted)")
            self.videoOverlay.setAudioMuted(isMuted)
            self.emitSnapshot()
        }
    }

    private func updateVideoOverlayMode(_ overlayMode: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self, var snapshot = self.activeCall else { return }
            snapshot.videoOverlayMode = overlayMode
            self.activeCall = snapshot
            self.emitSnapshot()
        }
    }

    @MainActor
    private func clearNativeCallState(deactivateAudio: Bool) -> Room? {
        connectTask?.cancel()
        connectTask = nil
        if deactivateAudio, isCallKitAudioActive {
            deactivateAudioEngine()
        }
        let r = room
        room = nil
        activeCallUUID = nil
        activeCall = nil
        desiredAudioMuted = false
        pinnedRemoteVideoParticipantId = nil
        speakingRemoteParticipantIds = []
        participantDisplayNamesByIdentity = [:]
        onParticipantIdentitiesChanged([])
        pictureInPicture.stopAndReset()
        audioRouteController.resetSpeakerOverride()
        emitSnapshot()
        videoOverlay.reset()
        return r
    }

    private func emitSnapshot() {
        if let activeCall {
            print("[CallKit] Emitting native snapshot state=\(activeCall.connectionState) channelId=\(activeCall.channelId) callId=\(activeCall.callId)")
        } else {
            print("[CallKit] Emitting native snapshot state=disconnected")
        }
        onSnapshotChanged(activeCall)
    }
}

private final class CallKitAudioEngineLogger: AudioEngineObserver, @unchecked Sendable {
    var next: (any AudioEngineObserver)?
    var desiredMutedProvider: (() -> Bool?)?

    func engineDidCreate(_ engine: AVAudioEngine) -> Int {
        print("[CallKit] LiveKit audio engine did create desiredMuted=\(describeDesiredMuted())")
        return next?.engineDidCreate(engine) ?? 0
    }

    func engineWillEnable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine will enable playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        let result = next?.engineWillEnable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        print("[CallKit] LiveKit audio engine will enable result=\(result)")
        return result
    }

    func engineWillStart(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine will start playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        let result = next?.engineWillStart(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        print("[CallKit] LiveKit audio engine will start result=\(result)")
        return result
    }

    func engineDidStop(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine did stop playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        return next?.engineDidStop(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
    }

    func engineDidDisable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine did disable playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        return next?.engineDidDisable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
    }

    func engineWillRelease(_ engine: AVAudioEngine) -> Int {
        print("[CallKit] LiveKit audio engine will release desiredMuted=\(describeDesiredMuted())")
        return next?.engineWillRelease(engine) ?? 0
    }

    func engineWillConnectOutput(
        _ engine: AVAudioEngine,
        src: AVAudioNode,
        dst: AVAudioNode?,
        format: AVAudioFormat,
        context: [AnyHashable: Any]
    ) -> Int {
        print("[CallKit] LiveKit audio engine will connect output format=\(format) desiredMuted=\(describeDesiredMuted())")
        return next?.engineWillConnectOutput(engine, src: src, dst: dst, format: format, context: context) ?? 0
    }

    func engineWillConnectInput(
        _ engine: AVAudioEngine,
        src: AVAudioNode?,
        dst: AVAudioNode,
        format: AVAudioFormat,
        context: [AnyHashable: Any]
    ) -> Int {
        print("[CallKit] LiveKit audio engine will connect input format=\(format) desiredMuted=\(describeDesiredMuted())")
        return next?.engineWillConnectInput(engine, src: src, dst: dst, format: format, context: context) ?? 0
    }

    private func describeDesiredMuted() -> String {
        desiredMutedProvider?().map(String.init) ?? "nil"
    }
}
