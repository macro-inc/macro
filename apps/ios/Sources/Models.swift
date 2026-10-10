import Foundation

struct ChannelPage: Codable, Sendable {
    var items: [Channel]
    var nextCursor: String? = nil
    enum CodingKeys: String, CodingKey { case items; case nextCursor = "next_cursor" }
}

struct Channel: Codable, Identifiable, Sendable {
    var id: String
    var name: String? = nil
    var channelType: String = "public"
    var participants: [ChannelParticipant] = []
    var latestMessage: ChannelPreview? = nil
    var updatedAt: String = ""
    var viewedAt: String? = nil
    var isParticipant: Bool = true

    var preview: String { latestMessage?.deletedAt == nil ? latestMessage?.content ?? "No messages yet" : "Message deleted" }
    var date: Date { MessageDate.parse(latestMessage?.createdAt ?? updatedAt) }
    var hasUnread: Bool {
        guard let latestMessage else { return false }
        guard let viewedAt else { return true }
        return MessageDate.parse(latestMessage.createdAt) > MessageDate.parse(viewedAt)
    }

    enum CodingKeys: String, CodingKey {
        case id, name, participants
        case channelType = "channel_type", latestMessage = "latest_message"
        case updatedAt = "updated_at", viewedAt = "viewed_at", isParticipant = "is_participant"
    }
}

struct ChannelParticipant: Codable, Sendable {
    var userID: String
    var role: String = "member"
    enum CodingKeys: String, CodingKey { case userID = "user_id", role }
}

struct ChannelPreview: Codable, Sendable {
    var messageID: String
    var content: String
    var senderID: String
    var createdAt: String
    var deletedAt: String? = nil
    var threadID: String? = nil
    var updatedAt: String? = nil
    enum CodingKeys: String, CodingKey {
        case content
        case messageID = "message_id", senderID = "sender_id", createdAt = "created_at"
        case deletedAt = "deleted_at", threadID = "thread_id", updatedAt = "updated_at"
    }
}

struct MessageParent: Codable, Equatable, Sendable {
    var type: String = "channel"
    var id: String
}

struct MessageCursor: Codable, Equatable, Sendable {
    var createdAt: String
    var id: String
    enum CodingKeys: String, CodingKey { case createdAt = "created_at", id }
}

struct MessagePage: Codable, Sendable {
    var items: [ChatMessage]
    var nextCursor: MessageCursor? = nil
    var previousCursor: MessageCursor? = nil
    enum CodingKeys: String, CodingKey {
        case items
        case nextCursor = "next_cursor", previousCursor = "previous_cursor"
    }
}

struct ChatMessage: Codable, Identifiable, Sendable {
    var id: String
    var parent: MessageParent
    var senderID: String
    var content: String
    var createdAt: String
    var updatedAt: String
    var editedAt: String? = nil
    var deletedAt: String? = nil
    var threadID: String? = nil
    var attachments: [MessageAttachment] = []
    var reactions: [MessageReaction] = []
    var mentions: [MessageMention] = []
    var thread: MessageThreadPreview? = nil
    var state: MessageThreadState? = nil
    var sender: MessageSender? = nil
    var botProfile: BotProfile? = nil
    var nonce: String? = nil
    /// Legacy realtime frames omit collections that are present in canonical REST/message_update data.
    var isPartial: Bool? = nil

    var channelID: String { parent.id }
    var date: Date { MessageDate.parse(createdAt) }
    var replyCount: Int { thread?.replyCount ?? 0 }
    var isDeleted: Bool { deletedAt != nil }

    enum CodingKeys: String, CodingKey {
        case id, parent, content, attachments, reactions, mentions, thread, state, sender, nonce, isPartial
        case senderID = "sender_id", createdAt = "created_at", updatedAt = "updated_at"
        case editedAt = "edited_at", deletedAt = "deleted_at", threadID = "thread_id", botProfile = "bot_profile"
    }
}

struct MessageAttachment: Codable, Identifiable, Sendable {
    var id: String
    var entityID: String
    var entityType: String
    var width: Double? = nil
    var height: Double? = nil
    enum CodingKeys: String, CodingKey {
        case id, width, height
        case entityID = "entity_id", entityType = "entity_type"
    }
}

struct MessageReaction: Codable, Sendable { var emoji: String; var users: [String] }
struct MessageMention: Codable, Sendable {
    var entityID: String
    var entityType: String
    enum CodingKeys: String, CodingKey { case entityID = "entity_id", entityType = "entity_type" }
}
struct MessageSender: Codable, Sendable {
    var type: String
    var id: String
    var name: String? = nil
    var avatarURL: String? = nil
    var triggeredBy: String? = nil
    enum CodingKeys: String, CodingKey { case type, id, name; case avatarURL = "avatar_url"; case triggeredBy = "triggered_by" }
}
struct BotProfile: Codable, Sendable {
    var name: String
    var avatarURL: String? = nil
    enum CodingKeys: String, CodingKey { case name; case avatarURL = "avatar_url" }
}

struct MessageThreadPreview: Codable, Sendable {
    var replyCount: Int = 0
    var preview: [ChatMessage] = []
    var latestReplyAt: String? = nil
    enum CodingKeys: String, CodingKey { case preview; case replyCount = "reply_count", latestReplyAt = "latest_reply_at" }
}

struct MessageThreadState: Codable, Sendable {
    var rootID: String
    var userID: String
    var createdAt: String
    var updatedAt: String
    var resolved: Bool = false
    var deletedAt: String? = nil
    enum CodingKeys: String, CodingKey {
        case resolved
        case rootID = "root_id", userID = "user_id", createdAt = "created_at"
        case updatedAt = "updated_at", deletedAt = "deleted_at"
    }
}

struct MessageEvent: Decodable, Sendable {
    var parent: MessageParent
    var actor: String
    var nonce: String? = nil
    var change: MessageChange
    var channelID: String { parent.id }
}

struct MessageChange: Decodable, Sendable {
    var type: String
    var message: ChatMessage? = nil
    var state: MessageThreadState? = nil
    var active: Bool? = nil
    var threadID: String? = nil
    enum CodingKeys: String, CodingKey { case type, message, state, active; case threadID = "thread_id" }
}

enum SocketStatus: String, Sendable { case connecting, connected, reconnecting, disconnected }

enum MessageDate {
    private static let lock = NSLock()
    private static let cache: NSCache<NSString, NSDate> = {
        let cache = NSCache<NSString, NSDate>()
        cache.countLimit = 8_192
        return cache
    }()
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let seconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parse(_ value: String) -> Date {
        let key = value as NSString
        if let date = cache.object(forKey: key) { return date as Date }
        lock.lock()
        defer { lock.unlock() }
        if let date = cache.object(forKey: key) { return date as Date }
        // Legacy edit/delete dates have no timezone; the service stores them in UTC.
        let date = fractional.date(from: value) ?? seconds.date(from: value)
            ?? fractional.date(from: value + "Z") ?? seconds.date(from: value + "Z") ?? .distantPast
        cache.setObject(date as NSDate, forKey: key)
        return date
    }

    static func string(_ date: Date = Date()) -> String {
        lock.lock()
        defer { lock.unlock() }
        return fractional.string(from: date)
    }
}

enum MessageID {
    static func date(_ id: String) -> Date? {
        guard let uuid = UUID(uuidString: id) else { return nil }
        let bytes = withUnsafeBytes(of: uuid.uuid) { Array($0) }
        guard bytes[6] >> 4 == 7 else { return nil }
        let milliseconds = bytes.prefix(6).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        return Date(timeIntervalSince1970: Double(milliseconds) / 1000)
    }

    /// The message service accepts client UUIDv7 identifiers within one day of server time.
    static func new(now: Date = Date()) -> String {
        let milliseconds = UInt64(max(0, now.timeIntervalSince1970 * 1000))
        var bytes = withUnsafeBytes(of: UUID().uuid) { Array($0) }
        for index in 0..<6 { bytes[index] = UInt8(truncatingIfNeeded: milliseconds >> (8 * (5 - index))) }
        bytes[6] = (bytes[6] & 0x0f) | 0x70
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        return [0..<8, 8..<12, 12..<16, 16..<20, 20..<32].map {
            String(hex[hex.index(hex.startIndex, offsetBy: $0.lowerBound)..<hex.index(hex.startIndex, offsetBy: $0.upperBound)])
        }.joined(separator: "-")
    }
}
