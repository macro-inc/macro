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

struct RgbaColorArgs: Decodable {
    let red: Double
    let green: Double
    let blue: Double
    let alpha: Double?
}

struct SetCallDrawerThemeArgs: Decodable {
    let drawerBackground: RgbaColorArgs
    let text: RgbaColorArgs
    let messageBackground: RgbaColorArgs
    let overlayBackground: RgbaColorArgs
    let edgeMuted: RgbaColorArgs
    let edge: RgbaColorArgs
    let inkMuted: RgbaColorArgs
    let failure: RgbaColorArgs
    let failureInk: RgbaColorArgs
    let success: RgbaColorArgs
}

struct StartOutgoingCallArgs: Decodable {
    let channelId: String
    let callId: String
    let channelTitle: String?
    let callerName: String?
    let serverUrl: String
    let token: String
}
