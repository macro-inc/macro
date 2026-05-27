import AVFAudio
import AVFoundation
import Foundation
import LiveKit

/// Native LiveKit Room plus CallKit-owned audio-session integration.
final class NativeLiveKitCallSession: NSObject, RoomDelegate, @unchecked Sendable {
    private let onSnapshotChanged: (ActiveCallSnapshot?) -> Void
    private let requestSystemEndCall: (UUID) -> Void
    private let videoOverlay: CallVideoOverlayController

    private var room: Room?
    private var connectTask: Task<Void, Never>?
    private var activeCallUUID: UUID?
    private var activeCall: ActiveCallSnapshot?
    private var didPrepareAudio = false
    private var isCallKitAudioActive = false
    private let audioEngineLogger = CallKitAudioEngineLogger()

    init(
        onSnapshotChanged: @escaping (ActiveCallSnapshot?) -> Void,
        requestSystemEndCall: @escaping (UUID) -> Void,
        videoOverlay: CallVideoOverlayController
    ) {
        self.onSnapshotChanged = onSnapshotChanged
        self.requestSystemEndCall = requestSystemEndCall
        self.videoOverlay = videoOverlay
        super.init()
        configureLiveKitAudioForCallKit()
        videoOverlay.onToggleMicrophone = { [weak self] in
            self?.toggleAudioFromOverlay()
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
        print("[CallKit] NativeLiveKitCallSession initialized")
    }

    func prepareForCallKitAudio() {
        guard !didPrepareAudio else { return }
        didPrepareAudio = true

        print("[CallKit] Prepared LiveKit audio for CallKit-controlled activation")
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

    func configureAudioSessionCategory() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.mixWithOthers]
            )
            try session.setPreferredIOBufferDuration(0.02)
            print("[CallKit] Configured AVAudioSession category for voice call \(describeAudioSession())")
        } catch {
            print("[CallKit] Failed to set audio session category: \(error) \(describeAudioSession())")
        }
    }

    func activateAudioEngine() {
        isCallKitAudioActive = true
        configureAudioSessionCategory()
        do {
            let availability = callKitAudioEngineAvailability()
            print("[CallKit] Enabling LiveKit audio engine after CallKit activation input=\(availability.isInputAvailable) output=\(availability.isOutputAvailable) \(describeAudioSession())")
            try AudioManager.shared.setEngineAvailability(availability)
            print("[CallKit] CallKit activated AVAudioSession; LiveKit audio engine available input=\(AudioManager.shared.engineAvailability.isInputAvailable) output=\(AudioManager.shared.engineAvailability.isOutputAvailable) running=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
        } catch {
            print("[CallKit] Failed to enable LiveKit audio engine after CallKit activation: \(error) \(describeAudioSession())")
        }
    }

    func deactivateAudioEngine() {
        isCallKitAudioActive = false
        do {
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

    func connect(uuid: UUID, channelId: String, serverUrl: String, token: String) {
        print("[CallKit] Native LiveKit connect requested uuid=\(uuid.uuidString) channelId=\(channelId)")
        prepareForCallKitAudio()

        print("[CallKit] Creating LiveKit Room uuid=\(uuid.uuidString)")
        let newRoom = Room(delegate: self)
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
        videoOverlay.setAudioMuted(false)
        videoOverlay.setLocalVideoEnabled(false)
        emitSnapshot()

        connectTask?.cancel()
        let oldRoom = room
        room = newRoom

        connectTask = Task { [weak self, oldRoom, weak newRoom] in
            if let oldRoom {
                print("[CallKit] Disconnecting previous LiveKit room before new connect uuid=\(uuid.uuidString)")
                await oldRoom.disconnect()
                print("[CallKit] Previous LiveKit room disconnected uuid=\(uuid.uuidString)")
            }
            guard let newRoom else { return }
            do {
                print("[CallKit] Connecting LiveKit room uuid=\(uuid.uuidString)")
                try await newRoom.connect(url: serverUrl, token: token)
                print("[CallKit] LiveKit room connected uuid=\(uuid.uuidString) roomSid=\(describeOptional(newRoom.sid)) remoteCount=\(newRoom.remoteParticipants.count)")
                self?.videoOverlay.presentForActiveCallIfNeeded()
                self?.attachBestRemoteVideoTrack(from: newRoom)
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
                guard await self?.ensureMicrophonePermission(uuid: uuid) ?? false else {
                    self?.updateAudioMuted(true, room: newRoom, uuid: uuid)
                    return
                }

                print("[CallKit] Enabling LiveKit microphone uuid=\(uuid.uuidString) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) callKitAudioActive=\(self?.isCallKitAudioActive ?? false) \(describeAudioSession())")
                let microphoneWarning = Task {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if !Task.isCancelled {
                        print("[CallKit] Still waiting for LiveKit microphone enable uuid=\(uuid.uuidString) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
                    }
                }
                defer { microphoneWarning.cancel() }
                try await newRoom.localParticipant.setMicrophone(enabled: true)
                self?.updateAudioMuted(false, room: newRoom, uuid: uuid)
                print("[CallKit] LiveKit microphone enabled uuid=\(uuid.uuidString) engineRunning=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
            } catch is CancellationError {
                print("[CallKit] LiveKit microphone enable cancelled uuid=\(uuid.uuidString)")
                return
            } catch {
                print("[CallKit] Failed to enable LiveKit microphone; keeping room connected uuid=\(uuid.uuidString) error=\(error) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) callKitAudioActive=\(self?.isCallKitAudioActive ?? false) \(describeAudioSession())")
                self?.updateAudioMuted(true, room: newRoom, uuid: uuid)
            }
        }
    }

    func disconnect() async {
        print("[CallKit] Native LiveKit disconnect requested")
        let toDisconnect: Room? = await MainActor.run {
            self.connectTask?.cancel()
            self.connectTask = nil
            let r = self.room
            self.room = nil
            self.activeCallUUID = nil
            self.activeCall = nil
            self.emitSnapshot()
            self.videoOverlay.reset()
            return r
        }

        if let toDisconnect {
            await toDisconnect.disconnect()
            print("[CallKit] Native LiveKit room disconnected")
        } else {
            print("[CallKit] Native LiveKit disconnect had no active room")
        }
    }

    func setAudioMuted(_ muted: Bool) {
        guard let room, let uuid = activeCallUUID else {
            print("[CallKit] setAudioMuted ignored; no active native room muted=\(muted)")
            return
        }

        Task { [weak self, weak room] in
            guard let self, let room else { return }

            do {
                if muted {
                    print("[CallKit] Muting native LiveKit microphone uuid=\(uuid.uuidString)")
                    try await room.localParticipant.setMicrophone(enabled: false)
                    self.updateAudioMuted(true, room: room, uuid: uuid)
                    print("[CallKit] Native LiveKit microphone muted uuid=\(uuid.uuidString)")
                    return
                }

                guard await self.ensureMicrophonePermission(uuid: uuid) else {
                    self.updateAudioMuted(true, room: room, uuid: uuid)
                    return
                }

                print("[CallKit] Unmuting native LiveKit microphone uuid=\(uuid.uuidString) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
                try await room.localParticipant.setMicrophone(enabled: true)
                self.updateAudioMuted(false, room: room, uuid: uuid)
                print("[CallKit] Native LiveKit microphone unmuted uuid=\(uuid.uuidString)")
            } catch {
                print("[CallKit] Failed to set native LiveKit microphone muted=\(muted) uuid=\(uuid.uuidString): \(error)")
                self.updateAudioMuted(true, room: room, uuid: uuid)
            }
        }
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
                    self.videoOverlay.setLocalVideoTrack(room.localParticipant.firstCameraVideoTrack)
                    self.setVideoOverlayMode(.expanded)
                } else {
                    self.videoOverlay.setLocalVideoTrack(nil)
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
        updateVideoOverlayMode(mode.rawValue)
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

    private func endCallFromOverlay() {
        guard let uuid = activeCallUUID else {
            print("[CallKit] Native video overlay end call ignored; no active call")
            return
        }

        print("[CallKit] Native video overlay requesting CallKit end uuid=\(uuid.uuidString)")
        requestSystemEndCall(uuid)
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
                self.activeCallUUID = nil
                self.activeCall = nil
                self.emitSnapshot()
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
        print("[CallKit] LiveKit remote participant connected participantSid=\(describeOptional(participant.sid)) remoteCount=\(room.remoteParticipants.count)")
    }

    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        print("[CallKit] LiveKit remote participant disconnected participantSid=\(describeOptional(participant.sid)) remoteCount=\(room.remoteParticipants.count)")
    }

    func room(_ room: Room, participant: Participant, didUpdateState state: ParticipantState) {
        print("[CallKit] LiveKit participant state updated participantSid=\(describeOptional(participant.sid)) state=\(state)")
    }

    func room(_ room: Room, participant: Participant, didUpdateConnectionQuality quality: ConnectionQuality) {
        print("[CallKit] LiveKit participant quality updated participantSid=\(describeOptional(participant.sid)) quality=\(quality)")
    }

    func room(_ room: Room, participant: LocalParticipant, didPublishTrack publication: LocalTrackPublication) {
        print("[CallKit] LiveKit local track published \(describe(publication))")
        if let track = publication.track as? VideoTrack, publication.source == .camera {
            videoOverlay.setLocalVideoTrack(track)
            updateVideoMuted(false, overlayMode: "expanded")
        }
    }

    func room(_ room: Room, participant: LocalParticipant, didUnpublishTrack publication: LocalTrackPublication) {
        print("[CallKit] LiveKit local track unpublished \(describe(publication))")
        if publication.source == .camera {
            videoOverlay.setLocalVideoTrack(nil)
            updateVideoMuted(true, overlayMode: activeCall?.videoOverlayMode)
        }
    }

    func room(_ room: Room, participant: LocalParticipant, remoteDidSubscribeTrack publication: LocalTrackPublication) {
        print("[CallKit] LiveKit remote subscribed to local track \(describe(publication))")
    }

    func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        print("[CallKit] LiveKit remote track published participantSid=\(describeOptional(participant.sid)) \(describe(publication))")
    }

    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        print("[CallKit] LiveKit remote track subscribed participantSid=\(describeOptional(participant.sid)) \(describe(publication))")
        if let track = publication.track as? VideoTrack, publication.source == .camera {
            videoOverlay.setRemoteVideoTrack(track)
            setVideoOverlayMode(.expanded)
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        print("[CallKit] LiveKit remote track unsubscribed participantSid=\(describeOptional(participant.sid)) \(describe(publication))")
        if publication.source == .camera {
            attachBestRemoteVideoTrack(from: room)
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didFailToSubscribeTrackWithSid trackSid: Track.Sid, error: LiveKitError) {
        print("[CallKit] LiveKit remote track subscribe failed participantSid=\(describeOptional(participant.sid)) trackSid=\(trackSid) error=\(error)")
    }

    func room(
        _ room: Room,
        participant: Participant,
        trackPublication: TrackPublication,
        didUpdateIsMuted isMuted: Bool
    ) {
        print("[CallKit] LiveKit track mute updated participantSid=\(describeOptional(participant.sid)) \(describe(trackPublication)) muted=\(isMuted)")
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

    private func attachBestRemoteVideoTrack(from room: Room) {
        for participant in room.remoteParticipants.values {
            if let track = participant.firstCameraVideoTrack {
                videoOverlay.setRemoteVideoTrack(track)
                print("[CallKit] Attached existing remote camera track participantSid=\(describeOptional(participant.sid))")
                return
            }
        }
        videoOverlay.setRemoteVideoTrack(nil)
        print("[CallKit] No remote camera track available")
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
            snapshot.isAudioMuted = isMuted
            self.activeCall = snapshot
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

    func engineDidCreate(_ engine: AVAudioEngine) -> Int {
        print("[CallKit] LiveKit audio engine did create")
        return next?.engineDidCreate(engine) ?? 0
    }

    func engineWillEnable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine will enable playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled)")
        let result = next?.engineWillEnable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        print("[CallKit] LiveKit audio engine will enable result=\(result)")
        return result
    }

    func engineWillStart(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine will start playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled)")
        let result = next?.engineWillStart(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        print("[CallKit] LiveKit audio engine will start result=\(result)")
        return result
    }

    func engineDidStop(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine did stop playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled)")
        return next?.engineDidStop(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
    }

    func engineDidDisable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        print("[CallKit] LiveKit audio engine did disable playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled)")
        return next?.engineDidDisable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
    }

    func engineWillRelease(_ engine: AVAudioEngine) -> Int {
        print("[CallKit] LiveKit audio engine will release")
        return next?.engineWillRelease(engine) ?? 0
    }

    func engineWillConnectOutput(
        _ engine: AVAudioEngine,
        src: AVAudioNode,
        dst: AVAudioNode?,
        format: AVAudioFormat,
        context: [AnyHashable: Any]
    ) -> Int {
        print("[CallKit] LiveKit audio engine will connect output format=\(format)")
        return next?.engineWillConnectOutput(engine, src: src, dst: dst, format: format, context: context) ?? 0
    }

    func engineWillConnectInput(
        _ engine: AVAudioEngine,
        src: AVAudioNode?,
        dst: AVAudioNode,
        format: AVAudioFormat,
        context: [AnyHashable: Any]
    ) -> Int {
        print("[CallKit] LiveKit audio engine will connect input format=\(format)")
        return next?.engineWillConnectInput(engine, src: src, dst: dst, format: format, context: context) ?? 0
    }
}
