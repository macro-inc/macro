import XCTest
@testable import MacroNative

@MainActor
final class ChannelActionsTests: XCTestCase {
    private let origin = URL(string: "https://gateway.example.invalid")!
    private let user = "macro|sender@example.com"

    func testReplyUsesRootIDStableMessageIDAndAuthoredMentions() async throws {
        let id = MessageID.new()
        let content = "Hello " + MentionCandidate(kind: .user, id: "macro|maya@example.com", title: "Maya").token.wire
        let response = try JSONEncoder().encode(message(id: id, content: content, rootID: "root"))
        let api = ChatActions(baseURL: origin, userID: user) { request in
            XCTAssertEqual(request.url?.path, "/dss/messages/channel/channel")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["thread_id"].string, "root")
            XCTAssertEqual(body["id"].string, id)
            XCTAssertEqual(body["nonce"].string, id)
            XCTAssertEqual(body["mentions"].array.first?["entity_id"].string, "macro|maya@example.com")
            XCTAssertEqual(body["attachments"].array.count, 0)
            return response
        }
        let result = try await api.reply(channelID: "channel", rootID: "root", content: content, nonce: id)
        XCTAssertEqual(result.threadID, "root")
    }

    func testDuplicateReplyRecoversExactlyTheSameRootWithoutPostingAgain() async throws {
        let id = MessageID.new()
        let response = try JSONEncoder().encode(message(id: id, content: "Retry", rootID: "root"))
        var requests: [URLRequest] = []
        let api = ChatActions(baseURL: origin, userID: user) { request in
            requests.append(request)
            if request.httpMethod == "POST" { throw MessagingError.http(409) }
            return response
        }
        let result = try await api.reply(channelID: "channel", rootID: "root", content: "Retry", nonce: id)
        XCTAssertEqual(result.id, id)
        XCTAssertEqual(requests.map(\.httpMethod), ["POST", "GET"])
        XCTAssertEqual(requests.last?.url?.path, "/dss/messages/channel/channel/items/\(id)")
    }

    func testReactionAndEditUsePartialCanonicalContracts() async throws {
        let existing = message(id: "message", content: "Before")
        let encoded = try JSONEncoder().encode(existing)
        var requests: [URLRequest] = []
        let api = ChatActions(baseURL: origin, userID: user) { requests.append($0); return encoded }
        _ = try await api.react(message: existing, emoji: "👍", add: true)
        _ = try await api.edit(message: existing, content: "After")
        _ = try await api.delete(message: existing)
        let reaction = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(requests[0].httpBody))
        XCTAssertEqual(requests[0].url?.path, "/dss/messages/channel/channel/items/message/reactions")
        XCTAssertEqual(reaction["emoji"].string, "👍")
        XCTAssertEqual(reaction["add"].bool, true)
        let edit = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(requests[1].httpBody))
        XCTAssertEqual(edit["content"].string, "After")
        XCTAssertEqual(edit["attachments"], .null, "Editing text must preserve existing attachments.")
        XCTAssertEqual(requests[2].httpMethod, "DELETE")
        XCTAssertNotNil(URLComponents(url: requests[2].url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "nonce" }))
    }

    func testEditSendsOnlyAttachmentChangesAndAllowsAttachmentOnlyContent() async throws {
        var existing = message(id: "message", content: "Before")
        let kept = MessageAttachment(id: "kept", entityID: "doc-kept", entityType: "document")
        let removed = MessageAttachment(id: "removed", entityID: "doc-removed", entityType: "document")
        let added = MessageAttachment(id: "local-new", entityID: "image-new", entityType: "static/image", width: 120, height: 80)
        existing.attachments = [kept, removed]
        let response = try JSONEncoder().encode(existing)
        let api = ChatActions(baseURL: origin, userID: user) { request in
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["content"].string, "")
            XCTAssertEqual(body["attachments"]["type"].string, "delta")
            XCTAssertEqual(body["attachments"]["value"]["remove"].array.compactMap(\.string), ["removed"])
            let additions = body["attachments"]["value"]["add"].array
            XCTAssertEqual(additions.count, 1)
            XCTAssertEqual(additions.first?["entity_id"].string, "image-new")
            XCTAssertEqual(additions.first?["id"], .null, "The server assigns canonical attachment IDs")
            return response
        }
        _ = try await api.edit(message: existing, content: "", attachments: [kept, added])
    }

    func testReadMarkerAndCreateChannelUseServerFieldNamesAndExcludeSelf() async throws {
        var requests: [URLRequest] = []
        let api = ChatActions(baseURL: origin, userID: user) { request in
            requests.append(request)
            return Data((request.url?.path == "/dss/channels/activity" ? #"{"viewed_at":"2026-01-01T00:00:00Z"}"# : #"{"id":"created"}"#).utf8)
        }
        let viewed = try await api.markRead(channelID: "channel")
        XCTAssertEqual(viewed, "2026-01-01T00:00:00Z")
        let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(requests[0].httpBody))
        XCTAssertEqual(body["activity_type"].string, "view")
        XCTAssertEqual(body["channel_id"].string, "channel")
        _ = try await api.createChannel(name: "New", participantIDs: [user, "macro|maya@example.com", "macro|maya@example.com"])
        let creation = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(requests[1].httpBody))
        XCTAssertEqual(creation["channel_type"].string, "private")
        XCTAssertEqual(creation["participants"].array.compactMap(\.string), ["macro|maya@example.com"])
    }

    func testThreadReceivesServerAssignedNonceAcknowledgementBeforeLateHTTPFailure() async throws {
        let parent = message(id: "root", content: "Root")
        let chat = ChatStore(api: ThreadTestMessagingService(), userID: user)
        var request: CheckedContinuation<Data, Error>?
        let api = ChatActions(baseURL: origin, userID: user) { input in
            if input.httpMethod == "POST" { return try await withCheckedThrowingContinuation { request = $0 } }
            return try self.threadData(parent)
        }
        let thread = NativeThreadStore(actions: api, chat: chat, parent: parent)
        await thread.start()
        thread.draft = "Immediate reply"
        let optimisticID = try XCTUnwrap(thread.send())
        XCTAssertEqual(thread.pending[optimisticID], .sending)
        XCTAssertEqual(thread.replies.first?.id, optimisticID)
        XCTAssertEqual(thread.draft, "")
        try await eventually { request != nil }
        var confirmed = try XCTUnwrap(thread.replies.first)
        confirmed.id = "server-id"; confirmed.nonce = nil
        chat.receive(MessageEvent(parent: parent.parent, actor: user, nonce: optimisticID,
            change: MessageChange(type: "posted", message: confirmed)))
        request?.resume(throwing: URLError(.timedOut))
        try await Task.sleep(for: .milliseconds(5))
        XCTAssertEqual(thread.replies.map(\.id), ["server-id"])
        XCTAssertNil(thread.pending[optimisticID])
        XCTAssertNil(thread.errors[optimisticID])
        thread.stop()
    }

    func testLegacyRootEditKeepsAttachmentsUntilCanonicalUpdateRemovesThem() async throws {
        var parent = message(id: "root", content: "With an attachment")
        parent.attachments = [.init(id: "attachment", entityID: "document", entityType: "document")]
        parent.reactions = [.init(emoji: "👍", users: [user])]
        parent.mentions = [.init(entityID: user, entityType: "user")]
        let chat = ChatStore(api: ThreadTestMessagingService(), userID: user)
        let api = ChatActions(baseURL: origin, userID: user) { _ in try self.threadData(parent) }
        let thread = NativeThreadStore(actions: api, chat: chat, parent: parent)
        await thread.start()
        defer { thread.stop() }

        var partial = message(id: "root", content: "Edited through an older client")
        partial.updatedAt = "2026-01-01T00:01:00Z"; partial.isPartial = true
        chat.receive(MessageEvent(parent: partial.parent, actor: user, change: MessageChange(type: "edited", message: partial)))
        XCTAssertEqual(thread.root?.content, partial.content)
        XCTAssertEqual(thread.root?.attachments.map(\.id), ["attachment"])
        XCTAssertEqual(thread.root?.reactions.first?.emoji, "👍")
        XCTAssertEqual(thread.root?.mentions.first?.entityID, user)

        partial.updatedAt = "2026-01-01T00:02:00Z"; partial.isPartial = false
        chat.receive(MessageEvent(parent: partial.parent, actor: user, change: MessageChange(type: "edited", message: partial)))
        XCTAssertEqual(thread.root?.attachments.count, 0, "A full canonical update can intentionally remove attachments.")
        XCTAssertEqual(thread.root?.reactions.count, 0)
        XCTAssertEqual(thread.root?.mentions.count, 0)
    }

    func testFailedThreadOutboxAndDraftSurviveClosingAndReopening() async throws {
        let parent = message(id: "root", content: "Root")
        let chat = ChatStore(api: ThreadTestMessagingService(), userID: user)
        let api = ChatActions(baseURL: origin, userID: user) { _ in throw URLError(.notConnectedToInternet) }
        let first = NativeThreadStore(actions: api, chat: chat, parent: parent)
        first.draft = "Keep this failed reply"
        let id = try XCTUnwrap(first.send())
        try await eventually { first.pending[id] == .failed }
        first.draft = "And keep this new draft"
        first.stop()

        let reopened = NativeThreadStore(actions: api, chat: chat, parent: parent)
        XCTAssertEqual(reopened.replies.map(\.id), [id])
        XCTAssertEqual(reopened.pending[id], .failed)
        XCTAssertEqual(reopened.draft, "And keep this new draft")
    }

    func testDemoActionsNeverUseTransport() async throws {
        let api = ChatActions(baseURL: origin, userID: user, isDemo: true) { _ in XCTFail("Demo network request"); throw MessagingError.invalidResponse }
        let parent = message(id: "root", content: "Root")
        api.seedDemo(parent)
        _ = try await api.thread(channelID: "channel", rootID: "root")
        let reply = try await api.reply(channelID: "channel", rootID: "root", content: "Reply", nonce: MessageID.new())
        _ = try await api.react(message: reply, emoji: "👍", add: true)
        _ = try await api.edit(message: reply, content: "Edited")
        _ = try await api.delete(message: reply)
        _ = try await api.markRead(channelID: "channel")
        try await api.join(channelID: "channel")
        try await api.invite(channelID: "channel", userIDs: ["macro|other@example.com"])
        _ = try await api.createChannel(name: "Demo", participantIDs: [])
    }

    private func message(id: String, content: String, rootID: String? = nil) -> ChatMessage {
        ChatMessage(id: id, parent: MessageParent(id: "channel"), senderID: user, content: content,
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", threadID: rootID)
    }
    private func threadData(_ root: ChatMessage) throws -> Data {
        let raw = try JSONDecoder().decode(WorkspaceJSON.self, from: JSONEncoder().encode(root))
        return try JSONEncoder().encode(WorkspaceJSON.object(["root": raw, "replies": .array([]), "state": .object([
            "root_id": .string(root.id), "user_id": .string(user), "created_at": .string(root.createdAt), "updated_at": .string(root.updatedAt), "resolved": .bool(false)])]))
    }
    private func eventually(_ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(2)
        while !condition(), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(1)) }
        XCTAssertTrue(condition())
    }
}

@MainActor
private final class ThreadTestMessagingService: MessagingService {
    func channels(cursor: String?) async throws -> ChannelPage { ChannelPage(items: []) }
    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage { MessagePage(items: []) }
    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage { throw MessagingError.invalidResponse }
    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage { throw MessagingError.invalidResponse }
    func userNames(userIDs: [String]) async throws -> [String: String] { [:] }
}
