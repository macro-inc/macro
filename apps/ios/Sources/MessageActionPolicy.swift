import Foundation

enum NativeMessageActionPolicy {
    static func canEdit(_ message: ChatMessage, userID: String, canWrite: Bool) -> Bool {
        canWrite && !userID.isEmpty && message.senderID == userID && !message.isDeleted
    }
    static func canDelete(_ message: ChatMessage, userID: String, canWrite: Bool) -> Bool {
        canWrite && !userID.isEmpty && !message.isDeleted && (message.senderID == userID || message.senderID.hasPrefix("bot|"))
    }
    static func link(_ message: ChatMessage, webURL: URL) -> URL {
        var components = URLComponents(url: webURL.appendingPathComponent("channel/" + message.channelID), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "channel_message_id", value: message.id)]
        if let threadID = message.threadID { components.queryItems?.append(URLQueryItem(name: "channel_thread_id", value: threadID)) }
        return components.url!
    }
    static func taskTitle(_ message: ChatMessage) -> String {
        let plain = MentionCodec.displayText(in: message.content).split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return plain.isEmpty ? "Follow up on message" : String(plain.prefix(70)) + (plain.count > 70 ? "…" : "")
    }
    static func taskReference(_ message: ChatMessage, channelName: String) -> String {
        var params = ["channel_message_id": message.id]
        if let threadID = message.threadID { params["channel_thread_id"] = threadID }
        let payload: [String: Any] = ["documentId": message.channelID, "documentName": channelName,
            "blockName": "channel", "blockParams": params, "collapsed": false]
        let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        let json = String(decoding: data, as: UTF8.self).replacingOccurrences(of: "<", with: "\\u003c").replacingOccurrences(of: ">", with: "\\u003e")
        return "<m-document-mention>" + json + "</m-document-mention>"
    }
}
