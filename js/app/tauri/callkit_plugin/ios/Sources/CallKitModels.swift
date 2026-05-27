import Foundation

struct PendingCallToken {
    let serverUrl: String
    let token: String
}

struct ActiveCallSnapshot {
    let channelId: String
    let callId: String
    var connectionState: String
    var isAudioMuted: Bool
}
