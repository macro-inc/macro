import Foundation

/// A persisted Lexical ReplyTargetNode. Its original wire stays untouched in drafts.
struct ReplyTargetQuote: Equatable, Identifiable, Sendable {
    struct Parent: Equatable, Sendable {
        let type: String
        let id: String
    }
    let parent: Parent
    let targetMessageId: String
    let targetThreadId: String
    let displayText: String
    let senderId: String
    let wire: String
    let range: NSRange
    var id: String { "\(range.location):\(parent.type):\(parent.id):\(targetMessageId)" }

    func senderName(currentUserID: String, names: [String: String]) -> String {
        if senderId == currentUserID { return "You" }
        if let name = names[senderId], !name.isEmpty { return name }
        if senderId.hasPrefix("bot|") { return "Agent" }
        if senderId.hasPrefix("macro|") { return senderId.dropFirst(6).components(separatedBy: "@").first ?? "Teammate" }
        return "Message"
    }
}

enum ReplyTargetContent {
    static func draftKey(channelID: String, rootID: String) -> String { "reply-target:\(channelID):\(rootID)" }

    static func wire(for message: ChatMessage) -> String? {
        guard let rootID = message.threadID else { return nil }
        let body = ChannelAgentCardContent.parse(split(message.content).body).body
        let preview = MentionCodec.displayText(in: body).split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let value: [String: Any] = ["parent": ["type": "channel", "id": message.channelID],
            "targetMessageId": message.id, "targetThreadId": rootID, "displayText": preview, "senderId": message.senderID]
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) else { return nil }
        return "<m-reply-target>" + json + "</m-reply-target>"
    }

    private static let pattern = try! NSRegularExpression(pattern: #"<m-reply-target>(.*?)</m-reply-target>"#, options: [.dotMatchesLineSeparators])

    /// Native renderers show these single-line quotes before the ordinary message body.
    /// Neither parsing nor rendering rewrites persisted content or creates notifications.
    static func split(_ wire: String) -> (quotes: [ReplyTargetQuote], body: String) {
        let quotes = parse(wire)
        let body = NSMutableString(string: wire)
        for quote in quotes.reversed() { body.replaceCharacters(in: quote.range, with: "") }
        return (quotes, (body as String).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func parse(_ wire: String) -> [ReplyTargetQuote] {
        matches(in: wire).compactMap { decode($0, in: wire) }
    }

    static func displayText(in wire: String) -> String { render(wire, markdown: false) }
    static func markdownForDisplay(in wire: String) -> String { render(wire, markdown: true) }

    private static func render(_ wire: String, markdown: Bool) -> String {
        let result = NSMutableString(string: wire)
        for match in matches(in: wire).reversed() {
            let preview = decode(match, in: wire)?.displayText ?? "Unknown reply"
            let rendered = markdown ? preview.components(separatedBy: .newlines).map { "> " + $0 }.joined(separator: "\n") : preview
            result.replaceCharacters(in: match.range, with: rendered)
        }
        return result as String
    }

    private static func matches(in wire: String) -> [NSTextCheckingResult] {
        let matches = pattern.matches(in: wire, range: NSRange(wire.startIndex..., in: wire))
        let code = MentionCodec.codeRanges(in: wire, mentionRanges: matches.map(\.range))
        return matches.filter { match in !code.contains { NSIntersectionRange($0, match.range).length > 0 } }
    }

    private static func decode(_ match: NSTextCheckingResult, in wire: String) -> ReplyTargetQuote? {
        let text = wire as NSString
        guard let json = text.substring(with: match.range(at: 1)).data(using: .utf8),
              let data = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any],
              let messageID = data["targetMessageId"] as? String,
              let threadID = data["targetThreadId"] as? String,
              let displayText = data["displayText"] as? String,
              let senderID = data["senderId"] as? String else { return nil }
        let parent: ReplyTargetQuote.Parent
        if let value = data["parent"] as? [String: Any], let type = value["type"] as? String,
           ["channel", "document"].contains(type), let id = value["id"] as? String, !id.isEmpty {
            parent = .init(type: type, id: id)
        } else if data["parent"] == nil, let channelID = data["channelId"] as? String, !channelID.isEmpty {
            // Lexical v3 persisted channelId before v4.3 introduced MessageParent.
            parent = .init(type: "channel", id: channelID)
        } else { return nil }
        return ReplyTargetQuote(parent: parent, targetMessageId: messageID, targetThreadId: threadID,
            displayText: displayText, senderId: senderID, wire: text.substring(with: match.range), range: match.range)
    }
}
