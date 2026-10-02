import Foundation

struct ChannelThread: Decodable, Sendable {
    var root: ChatMessage
    var replies: [ChatMessage]
    var state: MessageThreadState
}

@MainActor
final class ChatActions {
    typealias Request = @MainActor (URLRequest) async throws -> Data
    let userID: String
    let isDemo: Bool
    private let baseURL: URL
    private let requestData: Request
    private var demoMessages: [String: ChatMessage] = [:]
#if DEBUG
    private var demoFailedOnce = false
#endif

    convenience init(session: NativeSession) {
        self.init(baseURL: session.environment.gatewayURL, userID: session.userID ?? "", isDemo: session.isDemo) { request in
            do { return try await session.authenticatedData(for: request) }
            catch NativeSessionError.requestFailed(let status) { throw MessagingError.http(status) }
        }
    }

    init(baseURL: URL, userID: String, isDemo: Bool = false, request: @escaping Request) {
        self.baseURL = baseURL; self.userID = userID; self.isDemo = isDemo; requestData = request
    }

    func seedDemo(_ message: ChatMessage) { if isDemo { demoMessages[message.id] = message } }

    func thread(channelID: String, rootID: String) async throws -> ChannelThread {
        if isDemo {
            let root = demoMessages[rootID] ?? ChatMessage(id: rootID, parent: MessageParent(id: channelID), senderID: userID,
                content: "A native conversation thread", createdAt: MessageDate.string(Date()), updatedAt: MessageDate.string(Date()))
            return ChannelThread(root: root, replies: demoMessages.values.filter { $0.threadID == rootID }.sorted { $0.date < $1.date },
                state: root.state ?? MessageThreadState(rootID: rootID, userID: root.senderID, createdAt: root.createdAt, updatedAt: root.updatedAt))
        }
        return try await decode(ChannelThread.self, path: "\(path(channelID))/threads/\(rootID)")
    }

    func reply(channelID: String, rootID: String, content: String, nonce: String) async throws -> ChatMessage {
        let content = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { throw WorkspaceError.server("Enter a reply.") }
        if isDemo {
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--test-thread-send-failure") && !demoFailedOnce {
                demoFailedOnce = true
                throw URLError(.notConnectedToInternet)
            }
#endif
            let now = MessageDate.string(Date())
            let message = ChatMessage(id: nonce, parent: MessageParent(id: channelID), senderID: userID, content: content,
                createdAt: now, updatedAt: now, threadID: rootID, mentions: MentionCodec.mentions(in: content), nonce: nonce)
            demoMessages[nonce] = message; return message
        }
        if let created = MessageID.date(nonce), Date().timeIntervalSince(created) > 86_400 {
            do { return try await recoverReply(channelID: channelID, rootID: rootID, content: content, id: nonce) }
            catch MessagingError.http(404) { throw MessagingError.expiredDraft }
        }
        let body = ReplyBody(id: nonce, content: content, threadID: rootID, nonce: nonce, mentions: MentionCodec.mentions(in: content))
        do { return try await decode(ChatMessage.self, path: path(channelID), method: "POST", body: JSONEncoder().encode(body)) }
        catch MessagingError.http(409) { return try await recoverReply(channelID: channelID, rootID: rootID, content: content, id: nonce) }
    }

    func react(channelID: String, messageID: String, emoji: String, add: Bool) async throws -> ChatMessage {
        if isDemo {
            guard var message = demoMessages[messageID] else { throw MessagingError.http(404) }
            if let index = message.reactions.firstIndex(where: { $0.emoji == emoji }) {
                message.reactions[index].users.removeAll { $0 == userID }
                if add { message.reactions[index].users.append(userID) }
                if message.reactions[index].users.isEmpty { message.reactions.remove(at: index) }
            } else if add { message.reactions.append(MessageReaction(emoji: emoji, users: [userID])) }
            demoMessages[messageID] = message; return message
        }
        return try await decode(ChatMessage.self, path: "\(path(channelID))/items/\(messageID)/reactions", method: "POST",
            body: JSONEncoder().encode(ReactionBody(emoji: emoji, add: add, nonce: MessageID.new())))
    }

    func react(message: ChatMessage, emoji: String, add: Bool) async throws -> ChatMessage {
        seedDemo(message); return try await react(channelID: message.channelID, messageID: message.id, emoji: emoji, add: add)
    }

    func edit(message: ChatMessage, content: String, attachments: [MessageAttachment]? = nil) async throws -> ChatMessage {
        guard message.senderID == userID, !message.isDeleted else { throw MessagingError.http(403) }
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !(attachments ?? message.attachments).isEmpty else { throw WorkspaceError.server("Enter a message.") }
        if isDemo {
            var edited = message; edited.content = content; edited.updatedAt = MessageDate.string(Date()); edited.editedAt = edited.updatedAt
            edited.mentions = MentionCodec.mentions(in: content); if let attachments { edited.attachments = attachments }; demoMessages[edited.id] = edited; return edited
        }
        return try await decode(ChatMessage.self, path: "\(path(message.channelID))/items/\(message.id)", method: "PATCH",
            body: JSONEncoder().encode(EditBody(content: content, mentions: MentionCodec.mentions(in: content), nonce: MessageID.new(), attachments: try attachments.map { next in
                AttachmentDelta(value: .init(remove: message.attachments.filter { previous in !next.contains { $0.id == previous.id } }.map(\.id),
                    add: try next.filter { candidate in !message.attachments.contains { $0.id == candidate.id } }.map(NewMessageAttachment.init)))
            })))
    }

    func delete(message: ChatMessage) async throws -> ChatMessage {
        guard !message.isDeleted, message.senderID == userID || message.senderID.hasPrefix("bot|") else { throw MessagingError.http(403) }
        if isDemo {
            var deleted = message; deleted.deletedAt = MessageDate.string(Date()); deleted.updatedAt = deleted.deletedAt!; deleted.content = ""
            demoMessages[deleted.id] = deleted; return deleted
        }
        return try await decode(ChatMessage.self, path: "\(path(message.channelID))/items/\(message.id)", method: "DELETE",
            query: [URLQueryItem(name: "nonce", value: MessageID.new())])
    }

    @discardableResult
    func markRead(channelID: String) async throws -> String {
        if isDemo { return MessageDate.string(Date()) }
        struct Activity: Decodable, Sendable { var viewed_at: String? }
        let result = try await decode(Activity.self, path: "dss/channels/activity", method: "POST",
            body: JSONEncoder().encode(ActivityBody(channelID: channelID, activityType: "view")))
        return result.viewed_at ?? MessageDate.string(Date())
    }

    func join(channelID: String) async throws {
        if isDemo { return }
        _ = try await request(path: "dss/channels/\(channelID)/join", method: "POST")
    }

    func invite(channelID: String, userIDs: [String]) async throws {
        guard !userIDs.isEmpty else { return }
        if isDemo { return }
        _ = try await request(path: "dss/channels/\(channelID)/participants", method: "POST",
            body: JSONEncoder().encode(ParticipantsBody(participants: Array(Set(userIDs.filter { $0 != userID })))))
    }

    func createChannel(name: String?, participantIDs: [String], channelType: String = "private", teamID: String? = nil) async throws -> String {
        guard ["public", "private", "direct_message", "team"].contains(channelType) else { throw WorkspaceError.invalidResponse }
        if isDemo { return UUID().uuidString.lowercased() }
        struct Created: Decodable, Sendable { var id: String }
        return try await decode(Created.self, path: "dss/channels", method: "POST", body: JSONEncoder().encode(
            CreateBody(name: name, channelType: channelType, participants: Array(Set(participantIDs.filter { $0 != userID })), teamID: teamID))).id
    }

    private func recoverReply(channelID: String, rootID: String, content: String, id: String) async throws -> ChatMessage {
        let message = try await decode(ChatMessage.self, path: "\(path(channelID))/items/\(id)")
        guard message.threadID == rootID, message.content == content else { throw MessagingError.inconsistentRetry }
        return message
    }

    private func path(_ channelID: String) -> String { "dss/messages/channel/\(channelID)" }
    private func request(path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil) async throws -> Data {
        guard !isDemo else { throw MessagingError.invalidResponse }
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!); request.httpMethod = method; request.httpBody = body
        request.timeoutInterval = 30; request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try await requestData(request)
    }
    private func decode<T: Decodable & Sendable>(_ type: T.Type, path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil) async throws -> T {
        let data = try await request(path: path, method: method, query: query, body: body)
        return try await Task.detached(priority: .userInitiated) { try JSONDecoder().decode(type, from: data) }.value
    }

    private struct ReplyBody: Encodable {
        var id: String; var content: String; var threadID: String; var nonce: String; var mentions: [MessageMention]; var attachments: [String] = []
        enum CodingKeys: String, CodingKey { case id, content, nonce, mentions, attachments; case threadID = "thread_id" }
    }
    private struct ReactionBody: Encodable { var emoji: String; var add: Bool; var nonce: String }
    private struct EditBody: Encodable { var content: String; var mentions: [MessageMention]; var nonce: String; var attachments: AttachmentDelta? }
    private struct AttachmentDelta: Encodable {
        let type = "delta"
        var value: Value
        struct Value: Encodable { var remove: [String]; var add: [NewMessageAttachment] }
    }
    private struct ActivityBody: Encodable {
        var channelID: String; var activityType: String
        enum CodingKeys: String, CodingKey { case channelID = "channel_id", activityType = "activity_type" }
    }
    private struct ParticipantsBody: Encodable { var participants: [String] }
    private struct CreateBody: Encodable {
        var name: String?; var channelType: String; var participants: [String]; var teamID: String?
        enum CodingKeys: String, CodingKey { case name, participants; case channelType = "channel_type", teamID = "team_id" }
    }
}
