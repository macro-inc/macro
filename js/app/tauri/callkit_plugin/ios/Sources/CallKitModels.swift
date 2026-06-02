import Foundation

struct PendingCallToken {
    let serverUrl: String
    let token: String
}

struct PendingCallInfo {
    let channelId: String
    let channelName: String?
    let callerName: String?
}

struct ActiveCallSnapshot {
    let channelId: String
    let callId: String
    var connectionState: String
    var isAudioMuted: Bool
    var isVideoMuted: Bool
    var videoOverlayMode: String
}

struct SetParticipantDisplayNameArgs: Decodable {
    let identity: String
    let displayName: String?
}
