import XCTest
@testable import MacroNative

@MainActor
final class ThreadAccessTests: XCTestCase {
    private let user = "macro|reader@example.com"
    private let origin = URL(string: "https://gateway.example.invalid")!

    func testDeniedThreadClearsPreviewDraftAndOutboxWhileNetworkErrorsKeepThem() async throws {
        for status in [403, 404, 500] {
            let parent = message("root", content: "Private root")
            let pending = message(MessageID.new(), content: "Private pending", threadID: parent.id)
            let chat = ChatStore(api: DeniedChannelService(), userID: user)
            chat.receive(MessageEvent(parent: parent.parent, actor: user, change: MessageChange(type: "posted", message: parent)))
            chat.setDraft("Private draft", channelID: "thread:channel:root")
            chat.setDraft("Private quoted reply", channelID: "reply-target:channel:root")
            chat.setDraft(String(decoding: try JSONEncoder().encode([pending]), as: UTF8.self), channelID: "thread-outbox:channel:root")
            let actions = ChatActions(baseURL: origin, userID: user) { _ in throw MessagingError.http(status) }
            let thread = NativeThreadStore(actions: actions, chat: chat, parent: parent)
            await thread.start()
            if status == 500 {
                XCTAssertEqual(thread.root?.content, "Private root")
                XCTAssertEqual(thread.replies.map(\.content), ["Private pending"])
                XCTAssertEqual(thread.draft, "Private draft")
                XCTAssertNotNil(chat.drafts["thread-outbox:channel:root"])
                XCTAssertEqual(chat.drafts["reply-target:channel:root"], "Private quoted reply")
            } else {
                XCTAssertNil(thread.root); XCTAssertTrue(thread.replies.isEmpty)
                XCTAssertTrue(thread.pending.isEmpty); XCTAssertEqual(thread.draft, "")
                XCTAssertNil(chat.drafts["thread:channel:root"]); XCTAssertNil(chat.drafts["thread-outbox:channel:root"])
                XCTAssertNil(chat.drafts["reply-target:channel:root"])
                XCTAssertTrue(chat.messages["channel"]?.isEmpty ?? true)
                thread.draft = "A late editor callback"
                XCTAssertNil(thread.send())
                thread.stop()
                XCTAssertNil(chat.drafts["thread:channel:root"]); XCTAssertNil(chat.drafts["thread-outbox:channel:root"])
            }
        }
    }

    func testLateSendResponseCannotRestoreDeniedThreadContent() async throws {
        let parent = message("root", content: "Private root")
        let chat = ChatStore(api: DeniedChannelService(), userID: user)
        var denied = false
        var response: CheckedContinuation<Data, Error>?
        let actions = ChatActions(baseURL: origin, userID: user) { request in
            if request.httpMethod == "POST" { return try await withCheckedThrowingContinuation { response = $0 } }
            if denied { throw MessagingError.http(403) }
            return try self.threadData(parent)
        }
        let thread = NativeThreadStore(actions: actions, chat: chat, parent: parent)
        await thread.start()
        thread.draft = "An in-flight reply"
        let id = try XCTUnwrap(thread.send())
        try await eventually { response != nil }
        denied = true
        await thread.refresh()
        response?.resume(returning: try JSONEncoder().encode(message(id, content: "An in-flight reply", threadID: parent.id)))
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertNil(thread.root); XCTAssertTrue(thread.replies.isEmpty); XCTAssertTrue(thread.pending.isEmpty)
        XCTAssertNil(chat.drafts["thread-outbox:channel:root"])
        thread.stop()
    }

    func testChannelDenialImmediatelyInvalidatesAnAlreadyOpenThread() async throws {
        let parent = message("root", content: "Private root")
        let service = DeniedChannelService()
        let chat = ChatStore(api: service, userID: user)
        let actions = ChatActions(baseURL: origin, userID: user) { _ in try self.threadData(parent) }
        let thread = NativeThreadStore(actions: actions, chat: chat, parent: parent)
        await thread.start()
        thread.draft = "Private draft"
        chat.setDraft("Private quoted reply", channelID: "reply-target:channel:root")
        await chat.open(Channel(id: "channel"))
        XCTAssertNil(thread.root); XCTAssertTrue(thread.isInaccessible); XCTAssertEqual(thread.draft, "")
        XCTAssertNil(chat.drafts["thread:channel:root"])
        XCTAssertNil(chat.drafts["reply-target:channel:root"])
        chat.setDraft("A late quote callback", channelID: "reply-target:channel:root")
        XCTAssertNil(chat.drafts["reply-target:channel:root"])
        thread.stop()
    }

    private func message(_ id: String, content: String, threadID: String? = nil) -> ChatMessage {
        ChatMessage(id: id, parent: MessageParent(id: "channel"), senderID: user, content: content,
                    createdAt: "2026-09-27T12:00:00Z", updatedAt: "2026-09-27T12:00:00Z", threadID: threadID)
    }
    private func threadData(_ root: ChatMessage) throws -> Data {
        let raw = try JSONDecoder().decode(WorkspaceJSON.self, from: JSONEncoder().encode(root))
        return try JSONEncoder().encode(WorkspaceJSON.object(["root": raw, "replies": .array([]), "state": .object([
            "root_id": .string(root.id), "user_id": .string(user), "created_at": .string(root.createdAt), "updated_at": .string(root.updatedAt), "resolved": .bool(false),
        ])]))
    }
    private func eventually(_ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(2)
        while !condition(), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(1)) }
        XCTAssertTrue(condition())
    }
}

@MainActor
private final class DeniedChannelService: MessagingService {
    func channels(cursor: String?) async throws -> ChannelPage { ChannelPage(items: [Channel(id: "channel")]) }
    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage { throw MessagingError.http(403) }
    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage { throw MessagingError.http(403) }
    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage { throw MessagingError.http(403) }
    func userNames(userIDs: [String]) async throws -> [String: String] { [:] }
}
