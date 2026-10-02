import Foundation

/// Feed/search channel rows are not limited to the first page of the chat list.
struct NativeChannelRoute {
    struct Target: Equatable, Sendable {
        var messageID: String
        var threadID: String?
    }
    var channel: Channel
    var hasMembership: Bool
    var hasMetadata: Bool

    /// A search hit is explicit. A Soup thread is a root container whose
    /// driving notification may point to a reply inside it.
    static func target(for item: WorkspaceItem, notifications: [WorkspaceNotification] = []) -> Target? {
        guard let channelID = channelID(for: item) else { return nil }
        func parsed(_ value: WorkspaceJSON) -> Target? {
            guard let id = value.firstString("message_id", "messageId"), !id.isEmpty else { return nil }
            let thread = value.firstString("thread_id", "threadId").flatMap { $0.isEmpty ? nil : $0 }
            return Target(messageID: id, threadID: thread)
        }
        if let target = parsed(item.payload["target"]) { return target }
        if let target = parsed(item.payload) { return target }
        if let target = item.payload["channel_message_search_results"].array.compactMap(parsed).first { return target }

        let isThread = item.entityType == "channel_message" || item.entityType == "channel_thread"
        let candidates = notifications.filter { $0.entityType == "channel" && $0.entityID == channelID }
            .sorted { MessageDate.parse($0.createdAt) > MessageDate.parse($1.createdAt) }
        let activeRoots = Set(candidates.compactMap { notification -> String? in
            let metadata = notification.metadata
            return ["channel_mention", "channel_message_reply"].contains(metadata["tag"].string ?? "")
                ? metadata["content"].firstString("threadId", "thread_id") : nil
        })
        for notification in candidates {
            if !isThread && !notification.isUnread { continue }
            let metadata = notification.metadata
            let tag = metadata["tag"].string ?? ""
            guard ["channel_mention", "channel_message_send", "channel_message_reply", "document_mention"].contains(tag),
                  let target = parsed(metadata["content"]) else { continue }
            if isThread {
                let root = target.threadID ?? target.messageID
                guard root == item.id else { continue }
            } else {
                // Thread/mention stacks have their own Inbox rows. A whole
                // channel row represents ordinary top-level sends only.
                guard tag != "channel_mention", tag != "channel_message_reply", target.threadID == nil,
                      !activeRoots.contains(target.messageID) else { continue }
            }
            return target
        }
        return isThread && !item.id.isEmpty ? Target(messageID: item.id, threadID: item.id) : nil
    }

    static func needsNotificationTarget(_ item: WorkspaceItem) -> Bool {
        guard channelID(for: item) != nil,
              item.payload["target"].object == nil,
              item.payload.firstString("message_id", "messageId") == nil,
              item.payload["channel_message_search_results"].array.isEmpty else { return false }
        return item.entityType == "channel_message" || item.entityType == "channel_thread" || item.isUnread
    }

    static func channelID(for item: WorkspaceItem) -> String? {
        guard item.kind == .channel else { return nil }
        if let id = item.channelID, !id.isEmpty { return id }
        for data in [item.payload, item.payload["metadata"], item.payload["channel"]] {
            if let id = data.firstString("channel_id", "channelId") { return id }
            if data["parent"]["type"].string == "channel", let id = data["parent"]["id"].string { return id }
        }
        // A thread/message ID must never be mistaken for its enclosing channel.
        return ["channel_message", "channel_thread"].contains(item.entityType) || item.id.isEmpty ? nil : item.id
    }

    init?(item: WorkspaceItem, userID: String) {
        guard let id = Self.channelID(for: item) else { return nil }
        let sources = [item.payload, item.payload["metadata"], item.payload["channel"]]
        let type = sources.compactMap { $0.firstString("channel_type", "channelType") }.first
        let name = sources.compactMap { $0.firstString("channel_name", "channelName", "name") }.first
            ?? (["Conversation", "Untitled", "Attachment"].contains(item.title) ? nil : item.title)
        let members = sources.first { $0.object?["participants"] != nil }
        let participants = members?["participants"].array.compactMap { value -> ChannelParticipant? in
            guard let id = value.firstString("user_id", "userId") else { return nil }
            return ChannelParticipant(userID: id, role: value["role"].string ?? "member")
        } ?? []
        let explicitMembership = sources.compactMap { $0["is_participant"].bool ?? $0["isParticipant"].bool }.first
        let membership = explicitMembership ?? members.map { _ in participants.contains { $0.userID == userID } }
        hasMembership = membership != nil
        hasMetadata = membership != nil && type != nil && name != nil
        channel = Channel(id: id, name: name, channelType: type ?? "public", participants: participants,
            updatedAt: item.updatedAt, viewedAt: sources.compactMap { $0.firstString("viewed_at", "viewedAt") }.first,
            isParticipant: membership ?? false)
    }
}

/// GET /channels/:id supplies metadata and participants; its legacy messages are ignored.
struct NativeChannelMetadata: Decodable {
    let channelID: String
    let channelName: String
    let channelType: String
    let participants: [ChannelParticipant]
    enum CodingKeys: String, CodingKey {
        case channelID = "channel_id", channelName = "channel_name", channelType = "channel_type", participants
    }
    func channel(for userID: String) -> Channel {
        Channel(id: channelID, name: channelName, channelType: channelType, participants: participants,
            isParticipant: participants.contains { $0.userID == userID })
    }
}
