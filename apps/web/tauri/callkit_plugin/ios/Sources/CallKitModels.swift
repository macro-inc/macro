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

/// A call answered through CallKit, held until JS drains it. JS receives the
/// UUID as `callId` and `answeredAtMs` (epoch ms when CXAnswerCallAction was
/// fulfilled) so it can tell a fresh answer from a stale replay.
struct AnsweredCall {
    let callUUID: UUID
    let channelId: String
    let nativeMedia: Bool
    let answeredAtMs: Double
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

struct ShowAlonePromptArgs: Decodable {
    let callId: String
    /// Epoch milliseconds when the server ends the call.
    let endsAtMs: Double
}

struct DismissAlonePromptArgs: Decodable {
    let callId: String
}

struct StartOutgoingCallArgs: Decodable {
    let channelId: String
    let callId: String
    let channelTitle: String?
    let callerName: String?
    let serverUrl: String
    let token: String
}
