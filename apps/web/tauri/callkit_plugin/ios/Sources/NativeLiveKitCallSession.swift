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
    private let requestEndActiveCall: (@escaping () -> Void) -> Void
    private let onDrawerOpened: (String) -> Void
    private let onParticipantIdentitiesChanged: ([String]) -> Void
    private let onAlonePromptStay: (String) -> Void
    private let videoOverlay: CallVideoOverlayController
    private lazy var pictureInPicture: CallPictureInPictureManaging = makeCallPictureInPictureController(
        sourceViewProvider: { [weak self] in
            self?.videoOverlay.pictureInPictureSourceView()
        },
        isCallActive: { [weak self] in
            self?.activeCallUUID != nil
        },
        onRestore: { [weak self] in
            guard let self else { return }
            // Restoring into a drawer with no call behind it shows a Leave
            // button that can never end anything.
            guard let channelId = self.activeCall?.channelId else {
                callKitLog("Picture in Picture restored with no active call; stopping it and resetting the overlay")
                self.pictureInPicture.stopAndReset()
                self.videoOverlay.reset()
                return
            }
            self.setVideoOverlayMode(.expanded)
            callKitLog("Picture in Picture restoring channelId=\(channelId)")
            self.onDrawerOpened(channelId)
        }
    )

    private var room: Room?
    private var connectTask: Task<Void, Never>?
    private var activeCallUUID: UUID?
    private var activeCall: ActiveCallSnapshot?
    private var pinnedRemoteVideoParticipantId: String?
    private var speakingRemoteParticipantIds: [String] = []
    private var participantDisplayNamesByIdentity: [String: String] = [:]
    private var lastPublishedVideoParticipants: [NativeVideoParticipant]?
    private var lastPublishedPrimaryParticipantId: String?
    private var didPrepareAudio = false
    private var isCallKitAudioActive = false
    private var isActivatingAudioEngine = false
    private var microphoneCoordinator = MicrophoneStateCoordinator()
    private var didApplyDefaultSpeakerRoute = false
    private var lastAudioRouteSnapshot: CallAudioRouteSnapshot?
    private var lastAudioEngineInputAvailable: Bool?
    private var lastAudioEngineOutputAvailable: Bool?
    private let audioEngineLogger = CallKitAudioEngineLogger()
    private let audioRouteController = CallAudioRouteController()
    private lazy var alonePrompt: CallAlonePromptController = {
        let prompt = CallAlonePromptController(windowSceneProvider: { [weak self] in
            self?.videoOverlay.presentationWindowScene()
        })
        prompt.onStay = { [weak self] callId in
            guard let self else { return }
            self.restartAloneBackstop()
            self.onAlonePromptStay(callId)
        }
        prompt.onLeave = { [weak self] in
            self?.endCallFromOverlay()
        }
        return prompt
    }()
    /// Mirrors the server's alone-in-call threshold.
    private let aloneBackstopDelay: TimeInterval = 5 * 60
    /// Set for the whole stretch the current room has no remote human, so the
    /// backstop notice posts at most once per stretch.
    private var aloneBackstop: DispatchWorkItem?

    init(
        onSnapshotChanged: @escaping (ActiveCallSnapshot?) -> Void,
        requestSystemEndCall: @escaping (UUID) -> Void,
        requestEndActiveCall: @escaping (@escaping () -> Void) -> Void,
        onDrawerOpened: @escaping (String) -> Void,
        onParticipantIdentitiesChanged: @escaping ([String]) -> Void,
        onAlonePromptStay: @escaping (String) -> Void,
        videoOverlay: CallVideoOverlayController
    ) {
        self.onSnapshotChanged = onSnapshotChanged
        self.requestSystemEndCall = requestSystemEndCall
        self.requestEndActiveCall = requestEndActiveCall
        self.onDrawerOpened = onDrawerOpened
        self.onParticipantIdentitiesChanged = onParticipantIdentitiesChanged
        self.onAlonePromptStay = onAlonePromptStay
        self.videoOverlay = videoOverlay
        super.init()
        audioEngineLogger.desiredMutedProvider = { [weak self] in
            self?.microphoneCoordinator.desiredMuted
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
        videoOverlay.isCallActive = { [weak self] in
            self?.activeCallUUID != nil
        }
        videoOverlay.onOpenDrawerFromThumbnail = { [weak self] in
            guard let channelId = self?.activeCall?.channelId else { return }
            callKitLog("Native video overlay opened from thumbnail channelId=\(channelId)")
            self?.onDrawerOpened(channelId)
        }
        videoOverlay.onModeChanged = { [weak self] mode in
            callKitLog("Picture in Picture refreshing source for overlay mode=\(mode.rawValue)")
            self?.updateVideoOverlayMode(mode.rawValue)
            self?.pictureInPicture.prepare()
        }
        audioRouteController.onRouteChanged = { [weak self] route in
            guard let self else { return }
            let previousRoute = self.lastAudioRouteSnapshot
            let previousInputAvailable = self.lastAudioEngineInputAvailable
            let previousOutputAvailable = self.lastAudioEngineOutputAvailable
            let inputAvailable = AudioManager.shared.engineAvailability.isInputAvailable
            let outputAvailable = AudioManager.shared.engineAvailability.isOutputAvailable
            self.lastAudioRouteSnapshot = route
            self.lastAudioEngineInputAvailable = inputAvailable
            self.lastAudioEngineOutputAvailable = outputAvailable
            self.videoOverlay.setAudioRoute(route)
            guard self.activeCallUUID != nil else { return }

            let routeChanged = previousRoute != route
            let audioAvailabilityChanged = previousInputAvailable != inputAvailable
                || previousOutputAvailable != outputAvailable
            guard routeChanged || audioAvailabilityChanged else {
                callKitLog("Audio route emit did not change route or engine availability; skipping microphone restore")
                return
            }

            self.defaultBuiltInSpeakerRouteOnceIfNeeded(reason: "audio route changed")

            if self.isCallKitAudioActive, !outputAvailable {
                self.activateAudioEngine(reason: "audio route changed")
            } else if self.canEnableMicrophoneAudio() {
                self.restoreMicrophoneIfNeeded(reason: "audio route changed")
            }
        }
        audioRouteController.startObserving()
        pictureInPicture.prepare()
        callKitLog("NativeLiveKitCallSession initialized")
    }

    func prepareForCallKitAudio() {
        guard !didPrepareAudio else { return }
        didPrepareAudio = true

        callKitLog("Prepared LiveKit audio for CallKit-controlled activation")
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
            callKitLog("Configured LiveKit audio for CallKit engine gating")
        } catch {
            callKitLog("Failed to gate LiveKit audio engine before CallKit activation: \(error)", level: .error)
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
            callKitLog("Configured AVAudioSession category for voice call reason=\(reason) \(describeAudioSession())")
            audioRouteController.emitCurrentRoute()
            defaultBuiltInSpeakerRouteOnceIfNeeded(reason: "audioSessionCategoryConfigured:\(reason)")
        } catch {
            callKitLog("Failed to set audio session category reason=\(reason): \(error) \(describeAudioSession())", level: .error)
        }
    }

    func activateAudioEngine(reason: String = "CallKit didActivate", audioSession: AVAudioSession? = nil) {
        guard !isActivatingAudioEngine else {
            callKitLog("Ignoring nested LiveKit audio engine activation reason=\(reason)")
            return
        }
        isActivatingAudioEngine = true
        defer { isActivatingAudioEngine = false }

        configureAudioSessionCategory(reason: reason)
        if !hasUsableAudioOutputRoute() {
            callKitLog("Activating LiveKit audio engine with empty AVAudioSession route reason=\(reason) \(describeAudioSession())")
        }
        do {
            if let audioSession {
                LKRTCAudioSession.sharedInstance().audioSessionDidActivate(audioSession)
                callKitLog("Notified LiveKit WebRTC audio session didActivate reason=\(reason)")
            }
            let availability = callKitAudioEngineAvailability()
            callKitLog("Enabling LiveKit audio engine after CallKit activation reason=\(reason) input=\(availability.isInputAvailable) output=\(availability.isOutputAvailable) \(describeAudioSession())")
            try AudioManager.shared.setEngineAvailability(availability)
            isCallKitAudioActive = true
            callKitLog("CallKit activated AVAudioSession; LiveKit audio engine available reason=\(reason) input=\(AudioManager.shared.engineAvailability.isInputAvailable) output=\(AudioManager.shared.engineAvailability.isOutputAvailable) running=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
            restoreMicrophoneIfNeeded(reason: reason)
        } catch {
            callKitLog("Failed to enable LiveKit audio engine after CallKit activation reason=\(reason): \(error) \(describeAudioSession())", level: .error)
        }
    }

    func deactivateAudioEngine(audioSession: AVAudioSession? = nil) {
        isCallKitAudioActive = false
        do {
            if let audioSession {
                LKRTCAudioSession.sharedInstance().audioSessionDidDeactivate(audioSession)
                callKitLog("Notified LiveKit WebRTC audio session didDeactivate")
            }
            callKitLog("Disabling LiveKit audio engine after CallKit deactivation \(describeAudioSession())")
            try AudioManager.shared.setEngineAvailability(.none)
            callKitLog("CallKit deactivated AVAudioSession; LiveKit audio engine unavailable input=\(AudioManager.shared.engineAvailability.isInputAvailable) output=\(AudioManager.shared.engineAvailability.isOutputAvailable) running=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
        } catch {
            callKitLog("Failed to disable LiveKit audio engine after CallKit deactivation: \(error) \(describeAudioSession())", level: .error)
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
        callKitLog("Native LiveKit connect requested uuid=\(uuid.uuidString) channelId=\(channelId)")
        let desiredAudioMuted = microphoneCoordinator.desiredMuted
        microphoneCoordinator.reset(desiredMuted: desiredAudioMuted)
        didApplyDefaultSpeakerRoute = false
        lastAudioRouteSnapshot = nil
        lastAudioEngineInputAvailable = nil
        lastAudioEngineOutputAvailable = nil
        prepareForCallKitAudio()
        audioRouteController.prepareForCall()

        callKitLog("Creating LiveKit Room uuid=\(uuid.uuidString)")
        let newRoom = Room(
            delegate: self,
            roomOptions: RoomOptions(suspendLocalVideoTracksInBackground: false)
        )
        callKitLog("Created LiveKit Room uuid=\(uuid.uuidString)")

        activeCallUUID = uuid
        activeCall = ActiveCallSnapshot(
            channelId: channelId,
            callId: uuid.uuidString,
            connectionState: "connecting",
            isAudioMuted: desiredAudioMuted,
            isVideoMuted: true,
            videoOverlayMode: "hidden"
        )
        pinnedRemoteVideoParticipantId = nil
        speakingRemoteParticipantIds = []
        lastPublishedVideoParticipants = nil
        lastPublishedPrimaryParticipantId = nil
        videoOverlay.setAudioMuted(desiredAudioMuted)
        videoOverlay.setLocalVideoEnabled(false)
        emitSnapshot()
        defaultBuiltInSpeakerRouteOnceIfNeeded(reason: "connect")

        connectTask?.cancel()
        let oldRoom = room
        room = newRoom

        connectTask = Task { [weak self, oldRoom, weak newRoom] in
            guard let self else { return }
            if let oldRoom {
                callKitLog("Disconnecting previous LiveKit room before new connect uuid=\(uuid.uuidString)")
                await oldRoom.disconnect()
                callKitLog("Previous LiveKit room disconnected uuid=\(uuid.uuidString)")
            }
            guard let newRoom else { return }
            do {
                callKitLog("Connecting LiveKit room uuid=\(uuid.uuidString)")
                try await newRoom.connect(url: serverUrl, token: token)
                let isCurrentRoom = await MainActor.run { () -> Bool in
                    guard self.activeCallUUID == uuid, self.room === newRoom else { return false }
                    callKitLog("LiveKit room connected uuid=\(uuid.uuidString) roomSid=\(self.describeOptional(newRoom.sid)) remoteCount=\(newRoom.remoteParticipants.count)")
                    callKitLog("LiveKit local participant \(self.describeParticipant(newRoom.localParticipant))")
                    for participant in newRoom.remoteParticipants.values {
                        callKitLog("LiveKit existing remote participant \(self.describeParticipant(participant))")
                    }
                    self.emitParticipantIdentities(from: newRoom)
                    self.videoOverlay.setLocalParticipantTitle(self.displayTitle(newRoom.localParticipant))
                    self.videoOverlay.presentForActiveCallIfNeeded()
                    self.rebuildRemoteVideoLayout(from: newRoom)
                    self.updateAloneBackstop(from: newRoom)
                    return true
                }
                guard isCurrentRoom else {
                    // The room was replaced or the call ended while connecting.
                    // Nothing else holds it, so leaving it connected would keep
                    // this user in the call server-side and could publish the
                    // microphone. disconnect() is idempotent if teardown already
                    // reached it.
                    callKitLog("Disconnecting LiveKit room whose connect completed after it went stale uuid=\(uuid.uuidString) roomSid=\(self.describeOptional(newRoom.sid)) state=\(self.describe(newRoom.connectionState))")
                    await newRoom.disconnect()
                    callKitLog("Stale LiveKit room disconnected uuid=\(uuid.uuidString)")
                    return
                }
            } catch is CancellationError {
                // Room.connect cleans the room up before rethrowing, so a
                // cancelled connect never leaves it connected.
                callKitLog("LiveKit connect task cancelled uuid=\(uuid.uuidString) state=\(self.describe(newRoom.connectionState))")
                return
            } catch {
                callKitLog("Failed to connect LiveKit room uuid=\(uuid.uuidString): \(error)", level: .error)
                DispatchQueue.main.async { [weak self, weak newRoom] in
                    guard let self, self.activeCallUUID == uuid, self.room === newRoom else { return }
                    self.requestSystemEndCall(uuid)
                }
                return
            }

            self.applyInitialMicrophoneState(room: newRoom, uuid: uuid, reason: "connect")
        }
    }

    func disconnect() async {
        callKitLog("Native LiveKit disconnect requested")
        let toDisconnect: Room? = await MainActor.run {
            self.clearNativeCallState(deactivateAudio: true)
        }

        if let toDisconnect {
            await toDisconnect.disconnect()
            callKitLog("Native LiveKit room disconnected")
        } else {
            callKitLog("Native LiveKit disconnect had no active room")
        }
    }

    func disconnectForAppTermination() {
        callKitLog("Native LiveKit app termination disconnect requested")
        let backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "CallKitLiveKitDisconnectOnTerminate") {
            callKitLog("Native LiveKit app termination disconnect background task expired")
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
                callKitLog("Native LiveKit room disconnected for app termination")
            } else {
                callKitLog("Native LiveKit app termination disconnect had no active room")
            }

            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
            }
        }
    }

    func setAudioMuted(_ muted: Bool) {
        guard activeCallUUID != nil, room != nil else {
            let generation = microphoneCoordinator.setDesiredMuted(muted)
            callKitLog("setAudioMuted queued; no active native room muted=\(muted) generation=\(generation)")
            return
        }

        setDesiredAudioMuted(muted, reason: "setAudioMuted")
    }

    func setParticipantDisplayName(identity: String, displayName: String?) {
        let trimmedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedIdentity = normalizedParticipantIdentity(trimmedIdentity)
        let trimmedName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedName = (trimmedName?.isEmpty == false) ? trimmedName : nil
        // The JS side re-syncs every participant's name whenever its query
        // settles; skip the full layout rebuild when nothing actually changed.
        if participantDisplayNamesByIdentity[trimmedIdentity] == normalizedName,
           participantDisplayNamesByIdentity[normalizedIdentity] == normalizedName {
            return
        }
        if let trimmedName, !trimmedName.isEmpty {
            participantDisplayNamesByIdentity[trimmedIdentity] = trimmedName
            participantDisplayNamesByIdentity[normalizedIdentity] = trimmedName
        } else {
            participantDisplayNamesByIdentity.removeValue(forKey: trimmedIdentity)
            participantDisplayNamesByIdentity.removeValue(forKey: normalizedIdentity)
        }

        callKitLog("Native LiveKit participant display name updated hasDisplayName=\(normalizedName != nil) knownNames=\(participantDisplayNamesByIdentity.count)")
        if let room {
            videoOverlay.setLocalParticipantTitle(displayTitle(room.localParticipant))
            rebuildRemoteVideoLayout(from: room)
        }
    }

    /// The server's alone-in-call warning, relayed by JS. Ignored unless it
    /// names the active call.
    func showAlonePrompt(callId: String, endsAtMs: Double) {
        guard let uuid = activeCallUUID, uuid.uuidString.caseInsensitiveCompare(callId) == .orderedSame else {
            callKitLog("Ignoring alone prompt; not the active call callId=\(callId) activeUuid=\(activeCallUUID?.uuidString ?? "nil")")
            return
        }
        alonePrompt.show(callId: callId, endsAtMs: endsAtMs)
    }

    func dismissAlonePrompt(callId: String) {
        alonePrompt.dismiss(callId: callId)
        guard let uuid = activeCallUUID, uuid.uuidString.caseInsensitiveCompare(callId) == .orderedSame else { return }
        // The server restarts its alone clock after a stay, so the backstop
        // starts a new stretch too (a no-op if someone else is here).
        restartAloneBackstop()
    }

    func setChannelTitle(_ title: String?) {
        videoOverlay.setChannelTitle(title)
    }

    func setVideoEnabled(_ enabled: Bool) {
        guard let room, let uuid = activeCallUUID else {
            callKitLog("setVideoEnabled ignored; no active native room enabled=\(enabled)")
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
                callKitLog("Setting native LiveKit camera enabled=\(enabled) uuid=\(uuid.uuidString)")
                try await room.localParticipant.setCamera(enabled: enabled)
                if enabled {
                    self.enableMultitaskingCameraAccessIfSupported(room: room, uuid: uuid)
                }
                // The call can end while the camera toggles; updating the overlay
                // afterwards would re-present the drawer with no call behind it.
                let isCurrentCall = await MainActor.run { () -> Bool in
                    guard self.activeCallUUID == uuid, self.isCurrentRoom(room) else { return false }
                    self.videoOverlay.setLocalVideoTrack(enabled ? room.localParticipant.firstCameraVideoTrack : nil)
                    self.rebuildRemoteVideoLayout(from: room)
                    if enabled {
                        self.setVideoOverlayMode(.expanded)
                    }
                    self.updateVideoMuted(!enabled, overlayMode: enabled ? "expanded" : self.activeCall?.videoOverlayMode)
                    return true
                }
                guard isCurrentCall else {
                    callKitLog("Ignoring native LiveKit camera result; call no longer active enabled=\(enabled) uuid=\(uuid.uuidString)")
                    return
                }
                callKitLog("Native LiveKit camera set enabled=\(enabled) uuid=\(uuid.uuidString)")
            } catch {
                callKitLog("Failed to set native LiveKit camera enabled=\(enabled) uuid=\(uuid.uuidString): \(error)", level: .error)
                self.updateVideoMuted(true, overlayMode: self.activeCall?.videoOverlayMode)
            }
        }
    }

    func setVideoOverlayMode(_ mode: CallVideoOverlayMode) {
        videoOverlay.setMode(mode)
    }

    private func toggleVideoFromOverlay() {
        let enabled = activeCall?.isVideoMuted ?? true
        callKitLog("Native video overlay requested camera enabled=\(enabled)")
        setVideoEnabled(enabled)
    }

    private func toggleAudioFromOverlay() {
        let muted = !(activeCall?.isAudioMuted ?? false)
        callKitLog("Native video overlay requested microphone muted=\(muted)")
        setAudioMuted(muted)
    }

    private func toggleSpeakerFromOverlay() {
        let currentOutput = audioRouteController.currentRouteSnapshot().output
        let enableSpeaker = currentOutput != .speaker
        callKitLog("Native video overlay requested speaker enabled=\(enableSpeaker) currentOutput=\(currentOutput.rawValue)")
        didApplyDefaultSpeakerRoute = true
        audioRouteController.setSpeakerEnabled(enableSpeaker)
    }

    /// Leave must always work, even when the drawer or PiP outlived the call.
    /// The coordinator's end path covers a desynced CallKit pointer, a failed
    /// CXEndCallAction request, and a provider callback that never arrives;
    /// its completion then tears down whatever native media or UI is left.
    private func endCallFromOverlay() {
        let endingUUID = activeCallUUID
        callKitLog("Native video overlay requesting call end uuid=\(endingUUID?.uuidString ?? "nil")")
        requestEndActiveCall { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let activeCallUUID = self.activeCallUUID, activeCallUUID != endingUUID {
                    callKitLog("Skipping native teardown after overlay end; another call is active uuid=\(activeCallUUID.uuidString)")
                    return
                }
                callKitLog("Native video overlay end completed; tearing down native call state uuid=\(endingUUID?.uuidString ?? "nil")")
                await self.disconnect()
            }
        }
    }

    private func togglePinnedRemoteVideoParticipant(_ participantId: String) {
        pinnedRemoteVideoParticipantId = pinnedRemoteVideoParticipantId == participantId ? nil : participantId
        callKitLog("Native video overlay pinned remote participant=\(pinnedRemoteVideoParticipantId != nil)")
        if let room {
            rebuildRemoteVideoLayout(from: room)
        }
    }

    func switchCamera() {
        guard let room, let uuid = activeCallUUID else {
            callKitLog("switchCamera ignored; no active native room")
            return
        }

        Task { [weak room] in
            guard
                let track = room?.localParticipant.firstCameraVideoTrack as? LocalVideoTrack,
                let capturer = track.capturer as? CameraCapturer
            else {
                callKitLog("switchCamera ignored; no active local camera track uuid=\(uuid.uuidString)")
                return
            }

            do {
                _ = try await capturer.switchCameraPosition()
                callKitLog("Native LiveKit camera switched uuid=\(uuid.uuidString)")
            } catch {
                callKitLog("Failed to switch native LiveKit camera uuid=\(uuid.uuidString): \(error)", level: .error)
            }
        }
    }

    func room(
        _ room: Room,
        didUpdateConnectionState connectionState: ConnectionState,
        from oldConnectionState: ConnectionState
    ) {
        let stateString = describe(connectionState)
        callKitLog("LiveKit connection state changed \(describe(oldConnectionState)) -> \(stateString) roomSid=\(describeOptional(room.sid))")
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
        callKitLog("LiveKit delegate didFailToConnect error=\(String(describing: error))", level: .error)
    }

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        callKitLog("LiveKit delegate didDisconnect error=\(String(describing: error))")
    }

    func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        callKitLog("LiveKit reconnect started mode=\(reconnectMode)")
    }

    func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) {
        callKitLog("LiveKit reconnect completed mode=\(reconnectMode)")
    }

    func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.room === room else { return }
            callKitLog("LiveKit remote participant connected \(self.describeParticipant(participant)) remoteCount=\(room.remoteParticipants.count)")
            self.emitParticipantIdentities(from: room)
            self.rebuildRemoteVideoLayout(from: room)
            self.updateAloneBackstop(from: room)
        }
    }

    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.room === room else { return }
            callKitLog("LiveKit remote participant disconnected \(self.describeParticipant(participant)) remoteCount=\(room.remoteParticipants.count)")
            let id = self.participantId(participant)
            if self.pinnedRemoteVideoParticipantId == id {
                self.pinnedRemoteVideoParticipantId = nil
            }
            self.speakingRemoteParticipantIds.removeAll { $0 == id }
            self.emitParticipantIdentities(from: room)
            self.rebuildRemoteVideoLayout(from: room)
            self.updateAloneBackstop(from: room)
        }
    }

    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.room === room else { return }
            let speakingIds = participants
                .filter { $0 is RemoteParticipant && !self.isAgentParticipant($0) }
                .map { self.participantId($0) }
            guard speakingIds != self.speakingRemoteParticipantIds else { return }
            self.speakingRemoteParticipantIds = speakingIds
            callKitLog("LiveKit speaking participants updated participants=\(participants.map { self.describeParticipant($0) })")
            self.rebuildRemoteVideoLayout(from: room)
        }
    }

    func room(_ room: Room, participant: Participant, didUpdateState state: ParticipantState) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            callKitLog("LiveKit participant state updated \(self.describeParticipant(participant)) state=\(state)")
        }
    }

    func room(_ room: Room, participant: Participant, didUpdateConnectionQuality quality: ConnectionQuality) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            callKitLog("LiveKit participant quality updated \(self.describeParticipant(participant)) quality=\(quality)")
        }
    }

    func room(_ room: Room, participant: LocalParticipant, didPublishTrack publication: LocalTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            callKitLog("LiveKit local track published \(self.describeParticipant(participant)) \(self.describe(publication))")
            guard self.isCurrentRoom(room) else {
                callKitLog("Ignoring local track publish from stale room")
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
            callKitLog("LiveKit local track unpublished \(self.describeParticipant(participant)) \(self.describe(publication))")
            guard self.isCurrentRoom(room) else {
                callKitLog("Ignoring local track unpublish from stale room")
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
            callKitLog("LiveKit remote subscribed to local track \(self.describeParticipant(participant)) \(self.describe(publication))")
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            callKitLog("LiveKit remote track published \(self.describeParticipant(participant)) \(self.describe(publication))")
            guard self.isCurrentRoom(room) else {
                callKitLog("Ignoring remote track publish from stale room")
                return
            }
            if publication.kind == .video {
                self.rebuildRemoteVideoLayout(from: room)
            }
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            callKitLog("LiveKit remote track subscribed \(self.describeParticipant(participant)) \(self.describe(publication))")
            // A stale room's late subscription must not re-expand a drawer
            // whose call already ended.
            guard self.isCurrentRoom(room) else {
                callKitLog("Ignoring remote track subscribe from stale room")
                return
            }
            if publication.track is VideoTrack, self.isRemoteVideoSource(publication.source) {
                self.rebuildRemoteVideoLayout(from: room)
                self.setVideoOverlayMode(.expanded)
            }
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room else { return }
            callKitLog("LiveKit remote track unsubscribed \(self.describeParticipant(participant)) \(self.describe(publication))")
            guard self.isCurrentRoom(room) else {
                callKitLog("Ignoring remote track unsubscribe from stale room")
                return
            }
            if self.isRemoteVideoSource(publication.source) {
                self.rebuildRemoteVideoLayout(from: room)
            }
        }
    }

    func room(_ room: Room, participant: RemoteParticipant, didFailToSubscribeTrackWithSid trackSid: Track.Sid, error: LiveKitError) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            callKitLog("LiveKit remote track subscribe failed \(self.describeParticipant(participant)) trackSid=\(trackSid) error=\(error)", level: .error)
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
            callKitLog("LiveKit track mute updated \(self.describeParticipant(participant)) \(self.describe(trackPublication)) muted=\(isMuted)")
            guard self.isCurrentRoom(room) else {
                callKitLog("Ignoring track mute update from stale room")
                return
            }
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
            callKitLog("Ignoring remote video layout rebuild from stale room")
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
        // Dictionary iteration order is unstable; sort so strip tiles don't
        // randomly permute between rebuilds.
        .sorted { $0.id < $1.id }

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

        // Tracks compare by identity in NativeVideoParticipant's Equatable, so
        // skip republishing when nothing the overlay renders actually changed —
        // speaker churn and JS name re-syncs otherwise flood it with no-ops.
        if participants != lastPublishedVideoParticipants || primary?.id != lastPublishedPrimaryParticipantId {
            lastPublishedVideoParticipants = participants
            lastPublishedPrimaryParticipantId = primary?.id
            videoOverlay.setRemoteVideoParticipants(participants, primaryId: primary?.id)
            callKitLog("Rebuilt remote video layout participants=\(participants.count) withVideo=\(participants.filter { $0.track != nil }.count) hasPrimary=\(primary != nil) pinned=\(pinnedRemoteVideoParticipantId != nil)")
        }
        updatePictureInPicture(from: room, primary: primary)
    }

    private func updatePictureInPicture(from room: Room, primary: NativeVideoParticipant?) {
        let localTrack = room.localParticipant.firstCameraVideoTrack
        callKitLog("Picture in Picture selected localTrack=\(localTrack != nil) hasPrimary=\(primary != nil) remoteTrack=\(primary?.track != nil)")
        pictureInPicture.setParticipants(
            localTitle: displayTitle(room.localParticipant),
            localTrack: localTrack,
            remoteTitle: primary?.title,
            remoteTrack: primary?.track
        )
    }

    private func enableMultitaskingCameraAccessIfSupported(room: Room, uuid: UUID?) {
        guard #available(iOS 16.0, *) else {
            callKitLog("Multitasking camera access unavailable before iOS 16 uuid=\(uuid?.uuidString ?? "nil")")
            return
        }
        guard
            let track = room.localParticipant.firstCameraVideoTrack as? LocalVideoTrack,
            let capturer = track.capturer as? CameraCapturer
        else {
            callKitLog("Multitasking camera access skipped; no local camera capturer uuid=\(uuid?.uuidString ?? "nil")")
            return
        }
        guard capturer.isMultitaskingAccessSupported else {
            callKitLog("Multitasking camera access not supported uuid=\(uuid?.uuidString ?? "nil")")
            return
        }

        capturer.isMultitaskingAccessEnabled = true
        callKitLog("Multitasking camera access enabled uuid=\(uuid?.uuidString ?? "nil") enabled=\(capturer.isMultitaskingAccessEnabled)")
    }

    private func emitParticipantIdentities(from room: Room) {
        guard isCurrentRoom(room) else {
            callKitLog("Ignoring participant identity emit from stale room")
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

    /// Background backstop for the server's alone-in-call timeout: the webview
    /// is usually suspended in the background, so the server's warning may
    /// never reach JS. After `aloneBackstopDelay` with no remote human while
    /// the app is not active, notify natively.
    private func updateAloneBackstop(from room: Room) {
        guard isCurrentRoom(room), let uuid = activeCallUUID else { return }
        if room.remoteParticipants.values.contains(where: { !isAgentParticipant($0) }) {
            guard let aloneBackstop else { return }
            callKitLog("Remote participant present; cancelling alone backstop uuid=\(uuid.uuidString)")
            aloneBackstop.cancel()
            self.aloneBackstop = nil
            alonePrompt.dismiss(callId: uuid.uuidString)
            return
        }
        guard aloneBackstop == nil else { return }

        callKitLog("No remote participants; starting alone backstop uuid=\(uuid.uuidString)")
        let backstop = DispatchWorkItem { [weak self] in
            guard let self, self.activeCallUUID == uuid else { return }
            guard UIApplication.shared.applicationState != .active else {
                callKitLog("Alone backstop reached while active; the server warning drives the prompt uuid=\(uuid.uuidString)")
                return
            }
            self.alonePrompt.notifyInBackground(callId: uuid.uuidString)
        }
        aloneBackstop = backstop
        DispatchQueue.main.asyncAfter(wallDeadline: .now() + aloneBackstopDelay, execute: backstop)
    }

    private func restartAloneBackstop() {
        aloneBackstop?.cancel()
        aloneBackstop = nil
        if let room {
            updateAloneBackstop(from: room)
        }
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

    /// SID only: identities are `macro|<email>` and names are display names,
    /// neither of which may reach the persisted log.
    private func describeParticipant(_ participant: Participant) -> String {
        "participantSid=\(describeOptional(participant.sid)) agent=\(isAgentParticipant(participant))"
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
            callKitLog("Microphone permission granted uuid=\(uuid.uuidString)")
            if isCallKitAudioActive && !AudioManager.shared.engineAvailability.isInputAvailable {
                do {
                    try AudioManager.shared.setEngineAvailability(.default)
                    callKitLog("Restored LiveKit input availability after microphone grant uuid=\(uuid.uuidString)")
                } catch {
                    callKitLog("Failed to restore LiveKit input availability after microphone grant uuid=\(uuid.uuidString): \(error)", level: .error)
                }
            }
            return true
        case .denied:
            setOutputOnlyAvailabilityIfNeeded(uuid: uuid)
            callKitLog("Microphone permission denied uuid=\(uuid.uuidString); keeping native room connected muted")
            return false
        case .undetermined:
            callKitLog("Microphone permission undetermined uuid=\(uuid.uuidString); requesting permission")
            let granted = await withCheckedContinuation { continuation in
                session.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
            callKitLog("Microphone permission request completed uuid=\(uuid.uuidString) granted=\(granted)")
            if granted, isCallKitAudioActive {
                do {
                    try AudioManager.shared.setEngineAvailability(.default)
                    callKitLog("Enabled LiveKit input availability after microphone permission request uuid=\(uuid.uuidString)")
                } catch {
                    callKitLog("Failed to enable LiveKit input availability after microphone permission request uuid=\(uuid.uuidString): \(error)", level: .error)
                }
            } else if !granted {
                setOutputOnlyAvailabilityIfNeeded(uuid: uuid)
            }
            return granted
        @unknown default:
            setOutputOnlyAvailabilityIfNeeded(uuid: uuid)
            callKitLog("Microphone permission unknown uuid=\(uuid.uuidString); keeping native room connected muted")
            return false
        }
    }

    private func ensureCameraPermission(uuid: UUID) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            callKitLog("Camera permission granted uuid=\(uuid.uuidString)")
            return true
        case .denied, .restricted:
            callKitLog("Camera permission denied uuid=\(uuid.uuidString)")
            return false
        case .notDetermined:
            callKitLog("Camera permission undetermined uuid=\(uuid.uuidString); requesting permission")
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            callKitLog("Camera permission request completed uuid=\(uuid.uuidString) granted=\(granted)")
            return granted
        @unknown default:
            callKitLog("Camera permission unknown uuid=\(uuid.uuidString)")
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

    private func defaultBuiltInSpeakerRouteOnceIfNeeded(reason: String) {
        guard activeCallUUID != nil else { return }
        guard !didApplyDefaultSpeakerRoute else { return }
        guard hasUsableAudioOutputRoute() else {
            callKitLog("Skipping built-in speaker default because AVAudioSession route is not ready reason=\(reason) \(describeAudioSession())")
            return
        }

        let route = audioRouteController.currentRouteSnapshot()
        guard route.supportsSpeakerToggle else { return }

        guard route.output != .speaker || !route.isSpeakerForced else {
            didApplyDefaultSpeakerRoute = true
            callKitLog("Built-in speaker default already satisfied reason=\(reason)")
            return
        }
        if route.output != .unknown {
            guard audioRouteController.canDefaultToSpeakerIfBuiltInRoute() else { return }
        }

        let didDefault = audioRouteController.defaultToSpeakerIfBuiltInRoute(reason: reason)
        didApplyDefaultSpeakerRoute = didDefault
        if !didDefault {
            callKitLog("Built-in speaker default did not apply; will retry on later route change reason=\(reason)")
        }
    }

    private func setDesiredAudioMuted(_ muted: Bool, reason: String) {
        guard let room, let uuid = activeCallUUID else { return }
        let generation = microphoneCoordinator.setDesiredMuted(muted)
        callKitLog("Native LiveKit desired microphone muted=\(muted) reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation) currentSnapshotMuted=\(activeCall?.isAudioMuted.description ?? "nil")")
        applyMicrophoneState(muted, room: room, uuid: uuid, generation: generation, reason: reason)
    }

    private func applyInitialMicrophoneState(room: Room, uuid: UUID, reason: String) {
        let muted = microphoneCoordinator.desiredMuted
        let generation = microphoneCoordinator.generation
        callKitLog("Applying initial LiveKit microphone state muted=\(muted) reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation)")
        applyMicrophoneState(muted, room: room, uuid: uuid, generation: generation, reason: reason)
    }

    private func restoreMicrophoneIfNeeded(reason: String) {
        guard let room, let uuid = activeCallUUID else { return }
        guard activeCall?.connectionState == "connected" else { return }
        guard canEnableMicrophoneAudio() else {
            callKitLog("Waiting to restore LiveKit microphone reason=\(reason) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
            return
        }
        guard let generation = microphoneCoordinator.beginRestoreIfNeeded() else {
            callKitLog("Skipping LiveKit microphone restore reason=\(reason) desiredMuted=\(microphoneCoordinator.desiredMuted) lastKnownMuted=\(microphoneCoordinator.describeLastKnownMuted()) restoreInFlight=\(microphoneCoordinator.isRestoreInFlight) lastApplyFailed=\(microphoneCoordinator.lastApplyFailed)")
            return
        }

        applyMicrophoneState(false, room: room, uuid: uuid, generation: generation, reason: reason)
    }

    private func applyMicrophoneState(
        _ muted: Bool,
        room: Room,
        uuid: UUID,
        generation: UInt64,
        reason: String
    ) {
        Task { [weak self, weak room] in
            guard let self, let room else { return }
            let enabled = !muted

            do {
                if enabled {
                    guard await self.ensureMicrophonePermission(uuid: uuid) else {
                        guard self.isCurrentMicrophoneOperation(generation, room: room, uuid: uuid, desiredMuted: muted) else { return }
                        self.updateAudioMuted(true, room: room, uuid: uuid, expectedGeneration: generation, applyFailed: false)
                        return
                    }

                    guard self.isCurrentMicrophoneOperation(generation, room: room, uuid: uuid, desiredMuted: muted) else {
                        callKitLog("Skipping LiveKit microphone unmute for stale desired state reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation) desiredMuted=\(self.microphoneCoordinator.desiredMuted)")
                        return
                    }
                    guard self.canEnableMicrophoneAudio() else {
                        callKitLog("Deferring LiveKit microphone unmute until CallKit audio engine is ready reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation) desiredMuted=\(self.microphoneCoordinator.desiredMuted) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(self.describeAudioSession())")
                        await self.markMicrophoneApplyDeferred(room: room, uuid: uuid, generation: generation)
                        return
                    }
                }

                guard self.isCurrentMicrophoneOperation(generation, room: room, uuid: uuid, desiredMuted: muted) else { return }

                let microphoneWarning = enabled ? Task {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if !Task.isCancelled {
                        callKitLog("Still waiting for LiveKit microphone enable reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(self.describeAudioSession())")
                    }
                } : nil
                defer { microphoneWarning?.cancel() }

                callKitLog("Applying native LiveKit microphone muted=\(muted) reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation) desiredMuted=\(self.microphoneCoordinator.desiredMuted) engineAvailable=\(AudioManager.shared.engineAvailability.isInputAvailable) engineRunning=\(AudioManager.shared.isEngineRunning) \(self.describeAudioSession())")
                try await room.localParticipant.setMicrophone(enabled: enabled)
                guard self.isCurrentMicrophoneOperation(generation, room: room, uuid: uuid, desiredMuted: muted) else {
                    callKitLog("Native LiveKit microphone apply completed after desired state changed reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation) desiredMuted=\(self.microphoneCoordinator.desiredMuted)")
                    return
                }
                self.updateAudioMuted(muted, room: room, uuid: uuid, expectedGeneration: generation, applyFailed: false)
                callKitLog("Native LiveKit microphone applied muted=\(muted) reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation)")
            } catch is CancellationError {
                callKitLog("LiveKit microphone apply cancelled reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation)")
            } catch {
                callKitLog("Failed to apply native LiveKit microphone muted=\(muted) reason=\(reason) uuid=\(uuid.uuidString) generation=\(generation) desiredMuted=\(self.microphoneCoordinator.desiredMuted): \(error)", level: .error)
                guard self.isCurrentMicrophoneOperation(generation, room: room, uuid: uuid, desiredMuted: muted) else { return }
                self.updateAudioMuted(muted, room: room, uuid: uuid, expectedGeneration: generation, applyFailed: true)
            }
        }
    }

    private func markMicrophoneApplyDeferred(room: Room, uuid: UUID, generation: UInt64) async {
        await MainActor.run {
            guard activeCallUUID == uuid, self.room === room else { return }
            _ = microphoneCoordinator.markApplyDeferred(generation: generation)
        }
    }

    private func isCurrentMicrophoneOperation(
        _ generation: UInt64,
        room: Room,
        uuid: UUID,
        desiredMuted: Bool
    ) -> Bool {
        activeCallUUID == uuid
            && self.room === room
            && microphoneCoordinator.desiredMuted == desiredMuted
            && microphoneCoordinator.generation == generation
    }

    private func setOutputOnlyAvailabilityIfNeeded(uuid: UUID) {
        guard isCallKitAudioActive else { return }
        do {
            try AudioManager.shared.setEngineAvailability(
                AudioEngineAvailability(isInputAvailable: false, isOutputAvailable: true)
            )
            callKitLog("Set LiveKit audio engine to output-only uuid=\(uuid.uuidString) running=\(AudioManager.shared.isEngineRunning) \(describeAudioSession())")
        } catch {
            callKitLog("Failed to set LiveKit audio engine to output-only uuid=\(uuid.uuidString): \(error) \(describeAudioSession())", level: .error)
        }
    }

    private func describeAudioSession() -> String {
        let session = AVAudioSession.sharedInstance()
        let inputs = session.currentRoute.inputs.map { $0.portType.rawValue }.joined(separator: ",")
        let outputs = session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
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

    private func updateAudioMuted(
        _ isMuted: Bool,
        room: Room,
        uuid: UUID,
        expectedGeneration: UInt64,
        applyFailed: Bool
    ) {
        DispatchQueue.main.async { [weak self, weak room] in
            guard let self, let room, self.activeCallUUID == uuid, self.room === room, var snapshot = self.activeCall else { return }
            guard self.microphoneCoordinator.finishApply(
                generation: expectedGeneration,
                actualMuted: isMuted,
                applyFailed: applyFailed
            ) else {
                callKitLog("Ignoring stale native microphone state update uuid=\(uuid.uuidString) generation=\(expectedGeneration) currentGeneration=\(self.microphoneCoordinator.generation) actualMuted=\(isMuted)")
                return
            }
            let previousMuted = snapshot.isAudioMuted
            guard previousMuted != isMuted else {
                callKitLog("Native LiveKit microphone state unchanged uuid=\(uuid.uuidString) actualMuted=\(isMuted) desiredMuted=\(self.microphoneCoordinator.desiredMuted) generation=\(expectedGeneration)")
                return
            }
            snapshot.isAudioMuted = isMuted
            self.activeCall = snapshot
            callKitLog("Native LiveKit microphone state updated uuid=\(uuid.uuidString) previousMuted=\(previousMuted) actualMuted=\(isMuted) desiredMuted=\(self.microphoneCoordinator.desiredMuted) generation=\(expectedGeneration)")
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
        let disconnectedSnapshot = activeCall.map { snapshot in
            ActiveCallSnapshot(
                channelId: snapshot.channelId,
                callId: snapshot.callId,
                connectionState: "disconnected",
                isAudioMuted: snapshot.isAudioMuted,
                isVideoMuted: snapshot.isVideoMuted,
                videoOverlayMode: snapshot.videoOverlayMode
            )
        }
        let r = room
        room = nil
        activeCallUUID = nil
        activeCall = nil
        microphoneCoordinator.reset(desiredMuted: false)
        didApplyDefaultSpeakerRoute = false
        lastAudioRouteSnapshot = nil
        lastAudioEngineInputAvailable = nil
        lastAudioEngineOutputAvailable = nil
        pinnedRemoteVideoParticipantId = nil
        speakingRemoteParticipantIds = []
        lastPublishedVideoParticipants = nil
        lastPublishedPrimaryParticipantId = nil
        participantDisplayNamesByIdentity = [:]
        onParticipantIdentitiesChanged([])
        pictureInPicture.stopAndReset()
        aloneBackstop?.cancel()
        aloneBackstop = nil
        alonePrompt.reset()
        audioRouteController.resetSpeakerOverride()
        if let disconnectedSnapshot {
            emitDisconnectedSnapshot(disconnectedSnapshot)
        } else {
            emitSnapshot()
        }
        videoOverlay.reset()
        return r
    }

    private func emitSnapshot() {
        if let activeCall {
            callKitLog("Emitting native snapshot state=\(activeCall.connectionState) channelId=\(activeCall.channelId) callId=\(activeCall.callId)")
        } else {
            callKitLog("Emitting native snapshot state=disconnected")
        }
        onSnapshotChanged(activeCall)
    }

    private func emitDisconnectedSnapshot(_ snapshot: ActiveCallSnapshot) {
        callKitLog("Emitting native snapshot state=disconnected channelId=\(snapshot.channelId) callId=\(snapshot.callId)")
        onSnapshotChanged(snapshot)
    }
}

private struct MicrophoneStateCoordinator {
    private(set) var desiredMuted = false
    private(set) var generation: UInt64 = 0
    private(set) var lastKnownMuted: Bool?
    private(set) var isRestoreInFlight = false
    private(set) var lastApplyFailed = false

    mutating func reset(desiredMuted: Bool) {
        self.desiredMuted = desiredMuted
        generation &+= 1
        lastKnownMuted = nil
        isRestoreInFlight = false
        lastApplyFailed = false
    }

    mutating func setDesiredMuted(_ muted: Bool) -> UInt64 {
        desiredMuted = muted
        generation &+= 1
        isRestoreInFlight = false
        if muted {
            lastApplyFailed = false
        }
        return generation
    }

    mutating func beginRestoreIfNeeded() -> UInt64? {
        guard !desiredMuted else { return nil }
        guard !isRestoreInFlight else { return nil }
        guard lastApplyFailed || lastKnownMuted != false else { return nil }
        isRestoreInFlight = true
        return generation
    }

    mutating func finishApply(generation expectedGeneration: UInt64, actualMuted: Bool, applyFailed: Bool) -> Bool {
        guard generation == expectedGeneration else { return false }
        lastKnownMuted = actualMuted
        lastApplyFailed = applyFailed
        isRestoreInFlight = false
        return true
    }

    mutating func markApplyDeferred(generation expectedGeneration: UInt64) -> Bool {
        guard generation == expectedGeneration else { return false }
        isRestoreInFlight = false
        return true
    }

    func describeLastKnownMuted() -> String {
        lastKnownMuted.map(String.init) ?? "nil"
    }
}

private final class CallKitAudioEngineLogger: AudioEngineObserver, @unchecked Sendable {
    var next: (any AudioEngineObserver)?
    var desiredMutedProvider: (() -> Bool?)?

    func engineDidCreate(_ engine: AVAudioEngine) -> Int {
        callKitLog("LiveKit audio engine did create desiredMuted=\(describeDesiredMuted())")
        return next?.engineDidCreate(engine) ?? 0
    }

    func engineWillEnable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        callKitLog("LiveKit audio engine will enable playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        let result = next?.engineWillEnable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        callKitLog("LiveKit audio engine will enable result=\(result)")
        return result
    }

    func engineWillStart(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        callKitLog("LiveKit audio engine will start playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        let result = next?.engineWillStart(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        callKitLog("LiveKit audio engine will start result=\(result)")
        return result
    }

    func engineDidStop(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        callKitLog("LiveKit audio engine did stop playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        return next?.engineDidStop(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
    }

    func engineDidDisable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        callKitLog("LiveKit audio engine did disable playout=\(isPlayoutEnabled) recording=\(isRecordingEnabled) desiredMuted=\(describeDesiredMuted())")
        return next?.engineDidDisable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
    }

    func engineWillRelease(_ engine: AVAudioEngine) -> Int {
        callKitLog("LiveKit audio engine will release desiredMuted=\(describeDesiredMuted())")
        return next?.engineWillRelease(engine) ?? 0
    }

    func engineWillConnectOutput(
        _ engine: AVAudioEngine,
        src: AVAudioNode,
        dst: AVAudioNode?,
        format: AVAudioFormat,
        context: [AnyHashable: Any]
    ) -> Int {
        callKitLog("LiveKit audio engine will connect output format=\(format) desiredMuted=\(describeDesiredMuted())")
        return next?.engineWillConnectOutput(engine, src: src, dst: dst, format: format, context: context) ?? 0
    }

    func engineWillConnectInput(
        _ engine: AVAudioEngine,
        src: AVAudioNode?,
        dst: AVAudioNode,
        format: AVAudioFormat,
        context: [AnyHashable: Any]
    ) -> Int {
        callKitLog("LiveKit audio engine will connect input format=\(format) desiredMuted=\(describeDesiredMuted())")
        return next?.engineWillConnectInput(engine, src: src, dst: dst, format: format, context: context) ?? 0
    }

    private func describeDesiredMuted() -> String {
        desiredMutedProvider?().map(String.init) ?? "nil"
    }
}
