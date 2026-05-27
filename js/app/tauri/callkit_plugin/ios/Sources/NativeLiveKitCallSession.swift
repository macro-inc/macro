import AVFAudio
import Foundation
import LiveKit

/// Native LiveKit Room plus CallKit-owned audio-session integration.
final class NativeLiveKitCallSession: NSObject, RoomDelegate, @unchecked Sendable {
    private let onSnapshotChanged: (ActiveCallSnapshot?) -> Void
    private let requestSystemEndCall: (UUID) -> Void

    private var room: Room?
    private var connectTask: Task<Void, Never>?
    private var activeCallUUID: UUID?
    private var activeCall: ActiveCallSnapshot?
    private var didPrepareAudio = false

    init(
        onSnapshotChanged: @escaping (ActiveCallSnapshot?) -> Void,
        requestSystemEndCall: @escaping (UUID) -> Void
    ) {
        self.onSnapshotChanged = onSnapshotChanged
        self.requestSystemEndCall = requestSystemEndCall
        super.init()
    }

    func prepareForCallKitAudio() {
        guard !didPrepareAudio else { return }
        didPrepareAudio = true

        // CallKit activates AVAudioSession; LiveKit must not race it.
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
        try? AudioManager.shared.setEngineAvailability(.none)
    }

    func configureAudioSessionCategory() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetoothHFP, .allowBluetoothA2DP, .duckOthers]
            )
        } catch {
            print("[CallKit] Failed to set audio session category: \(error)")
        }
    }

    func activateAudioEngine() {
        try? AudioManager.shared.setEngineAvailability(.default)
    }

    func deactivateAudioEngine() {
        try? AudioManager.shared.setEngineAvailability(.none)
    }

    func currentSnapshot() -> ActiveCallSnapshot? {
        activeCall
    }

    func connect(uuid: UUID, channelId: String, serverUrl: String, token: String) {
        prepareForCallKitAudio()

        let newRoom = Room(delegate: self)

        activeCallUUID = uuid
        activeCall = ActiveCallSnapshot(
            channelId: channelId,
            callId: uuid.uuidString,
            connectionState: "connecting",
            isAudioMuted: false
        )
        emitSnapshot()

        connectTask?.cancel()
        let oldRoom = room
        room = newRoom

        connectTask = Task { [weak self, oldRoom, weak newRoom] in
            if let oldRoom {
                await oldRoom.disconnect()
            }
            guard let newRoom else { return }
            do {
                try await newRoom.connect(url: serverUrl, token: token)
                try await newRoom.localParticipant.setMicrophone(enabled: true)
            } catch is CancellationError {
                return
            } catch {
                print("[CallKit] Failed to connect LiveKit room: \(error)")
                DispatchQueue.main.async { [weak self, weak newRoom] in
                    guard let self, self.activeCallUUID == uuid, self.room === newRoom else { return }
                    self.requestSystemEndCall(uuid)
                }
            }
        }
    }

    func disconnect() async {
        let toDisconnect: Room? = await MainActor.run {
            self.connectTask?.cancel()
            self.connectTask = nil
            let r = self.room
            self.room = nil
            self.activeCallUUID = nil
            self.activeCall = nil
            self.emitSnapshot()
            return r
        }

        if let toDisconnect {
            await toDisconnect.disconnect()
        }
    }

    func room(
        _ room: Room,
        didUpdateConnectionState connectionState: ConnectionState,
        from oldConnectionState: ConnectionState
    ) {
        let stateString = describe(connectionState)
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

    private func emitSnapshot() {
        onSnapshotChanged(activeCall)
    }
}
