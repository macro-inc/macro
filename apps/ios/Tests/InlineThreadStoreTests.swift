import XCTest
@testable import MacroNative

@MainActor
final class InlineThreadStoreTests: XCTestCase {
    private let user = "macro|me"
    private let channelID = "inline-channel"
    private func reply(_ index: Int) -> ChatMessage {
        let date = String(format: "2026-09-27T12:%02d:00Z", index)
        return ChatMessage(id: "reply-\(index)", parent: MessageParent(id: channelID), senderID: user,
            content: "Reply \(index)", createdAt: date, updatedAt: date, threadID: "root")
    }
    private func service() -> InlineMessagingService {
        let replies = (1...5).map(reply)
        let root = ChatMessage(id: "root", parent: MessageParent(id: channelID), senderID: user, content: "Root",
            createdAt: "2026-09-27T12:00:00Z", updatedAt: "2026-09-27T12:00:00Z",
            thread: MessageThreadPreview(replyCount: 5, preview: Array(replies.prefix(3)), latestReplyAt: replies.last?.createdAt))
        return InlineMessagingService(root: root, replies: replies)
    }
    private func event(_ message: ChatMessage) -> MessageEvent {
        MessageEvent(parent: message.parent, actor: message.senderID, change: MessageChange(type: "posted", message: message))
    }

    func testOpeningCappedPreviewLoadsLatestReplyIntoInlineTimeline() async {
        let api = service()
        let store = ChatStore(api: api, userID: user)
        await store.loadLatest(channelID)
        XCTAssertEqual(api.threadReads, 1)
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.map(\.id), (1...5).map { "reply-\($0)" })
        XCTAssertEqual(store.messages[channelID]?.first?.replyCount, 5)
    }

    func testSocketTailIsVisibleImmediatelyAndSurvivesStalePreviewRefresh() async {
        let api = service()
        let store = ChatStore(api: api, userID: user)
        store.receive(event(api.root))
        let newest = reply(6)
        store.receive(event(newest)); store.receive(event(newest))
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.last?.id, newest.id)
        XCTAssertEqual(store.messages[channelID]?.first?.replyCount, 6)
        store.receive(event(api.root))
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.last?.id, newest.id)
        await store.loadLatest(channelID)
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.last?.id, newest.id)
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.count, 6)
    }

    func testFreshReloadDiscoversMissingTailAndKeepsLiveReplyEdits() async {
        let api = service()
        let store = ChatStore(api: api, userID: user)
        store.receive(event(api.root))
        var edited = reply(2); edited.content = "Edited while reloading"; edited.updatedAt = "2026-09-27T13:00:00Z"
        store.receive(event(edited))
        await store.loadLatest(channelID)
        let replies = store.messages[channelID]?.first?.thread?.preview
        XCTAssertEqual(replies?.last?.id, "reply-5")
        XCTAssertEqual(replies?.first { $0.id == edited.id }?.content, edited.content)
    }

    func testReplySendIsOptimisticAndClearsOnlyItsThreadDraft() async throws {
        let api = service()
        let store = ChatStore(api: api, userID: user)
        store.receive(event(api.root)); store.setDraft("Main draft", channelID: channelID)
        store.setDraft("Thread draft", channelID: "thread:\(channelID):root")
        store.setDraft("Quote metadata", channelID: "reply-target:\(channelID):root")
        let id = try XCTUnwrap(store.send("New inline reply", channelID: channelID, threadID: "root"))
        XCTAssertEqual(store.pending[id], .sending)
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.last?.id, id)
        XCTAssertEqual(store.drafts["thread:\(channelID):root"], "")
        XCTAssertNil(store.drafts["reply-target:\(channelID):root"])
        XCTAssertEqual(store.drafts[channelID], "Main draft")
        for _ in 0..<100 where store.pending[id] == .sending { try await Task.sleep(for: .milliseconds(1)) }
        XCTAssertNil(store.pending[id])
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.filter { $0.id == id }.count, 1)
    }

    func testReplySocketRekeysOptimisticIDBeforeLateHTTPFailureWithServerClockBehind() async throws {
        let api = service(), userID = user
        let store = ChatStore(api: api, userID: userID)
        store.receive(event(api.root))
        var response: CheckedContinuation<ChatMessage, Error>?
        api.sendHandler = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let id = try XCTUnwrap(store.send("Reply with stable identity", channelID: channelID, threadID: "root"))
        for _ in 0..<100 where response == nil { try await Task.sleep(for: .milliseconds(1)) }
        var confirmed = try XCTUnwrap(store.messages[channelID]?.first?.thread?.preview.first { $0.id == id })
        confirmed.id = "server-reply"; confirmed.nonce = id
        confirmed.createdAt = "2026-09-27T12:10:00Z"; confirmed.updatedAt = confirmed.createdAt
        store.receive(event(confirmed)); store.receive(event(confirmed))
        response?.resume(throwing: URLError(.timedOut))
        try await Task.sleep(for: .milliseconds(5))
        let replies = store.messages[channelID]?.first?.thread?.preview ?? []
        XCTAssertFalse(replies.contains { $0.id == id })
        XCTAssertEqual(replies.filter { $0.id == "server-reply" }.count, 1)
        XCTAssertNil(store.pending[id]); XCTAssertNil(store.deliveryErrors[id])
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.latestReplyAt, confirmed.createdAt)
    }

    func testFailedInlineReplyRetriesTheSameMessageAndClearsError() async throws {
        let api = service(), userID = user
        var attempts: [String] = []
        api.sendHandler = { message in
            attempts.append(message.id)
            if attempts.count == 1 { throw URLError(.notConnectedToInternet) }
            return message
        }
        let store = ChatStore(api: api, userID: userID)
        store.receive(event(api.root))
        let id = try XCTUnwrap(store.send("Retry inline", channelID: channelID, threadID: "root"))
        for _ in 0..<100 where store.pending[id] == .sending { try await Task.sleep(for: .milliseconds(1)) }
        XCTAssertEqual(store.pending[id], .failed)
        XCTAssertNotNil(store.deliveryErrors[id])
        let failed = try XCTUnwrap(store.messages[channelID]?.first?.thread?.preview.first { $0.id == id })
        store.retry(failed)
        for _ in 0..<100 where store.pending[id] == .sending { try await Task.sleep(for: .milliseconds(1)) }
        XCTAssertEqual(attempts, [id, id])
        XCTAssertNil(store.pending[id]); XCTAssertNil(store.deliveryErrors[id])
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.filter { $0.id == id }.count, 1)
    }

    func testInlineTailPersistsAndSurvivesRestartWithCappedServerPreview() async throws {
        let account = "inline-tests-" + UUID().uuidString
        let disk = ChatDiskCache(account: account), api = service()
        let store = ChatStore(api: api, userID: user, cache: disk)
        await store.loadLatest(channelID)
        store.receive(event(reply(6)))
        store.suspend()
        for _ in 0..<100 {
            if await disk.read()?.messages[channelID]?.first?.thread?.preview.last?.id == "reply-6" { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let restored = ChatStore(api: service(), userID: user, cache: ChatDiskCache(account: account))
        await restored.start(); await restored.loadLatest(channelID)
        XCTAssertEqual(restored.messages[channelID]?.first?.thread?.preview.last?.id, "reply-6")
        await store.shutDown(); await restored.shutDown()
    }

    func testExpansionRequiresUserActionAndSurvivesHydrationAndNewReplies() async {
        let api = service(), store = ChatStore(api: service(), userID: user)
        await store.loadLatest(channelID)
        XCTAssertTrue(store.expandedThreadIDs.isEmpty)
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.count, 5)
        store.expandThread(rootID: "root")
        store.receive(event(reply(6)))
        store.receive(event(api.root))
        await store.loadLatest(channelID)
        XCTAssertEqual(store.expandedThreadIDs, ["root"])
        XCTAssertEqual(store.messages[channelID]?.first?.thread?.preview.last?.id, "reply-6")
        store.clearThreadData(channelID: channelID, rootID: "root")
        XCTAssertTrue(store.expandedThreadIDs.isEmpty)
        store.expandThread(rootID: "root")
        XCTAssertTrue(store.expandedThreadIDs.isEmpty, "An inaccessible root cannot recreate persisted UI state")
    }

    func testExpandedThreadsRestoreOnlyForTheSameAccount() async throws {
        let account = "expanded-thread-tests-" + UUID().uuidString
        let disk = ChatDiskCache(account: account)
        let store = ChatStore(api: service(), userID: user, cache: disk)
        await store.loadLatest(channelID)
        store.expandThread(rootID: "root")
        for _ in 0..<100 {
            if await disk.read()?.expandedThreadIDs.contains("root") == true { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let restored = ChatStore(api: service(), userID: user, cache: ChatDiskCache(account: account))
        await restored.start(); await restored.loadLatest(channelID)
        XCTAssertEqual(restored.expandedThreadIDs, ["root"])
        let other = ChatStore(api: service(), userID: "other-user", cache: ChatDiskCache(account: account + "-other"))
        await other.start(); await other.loadLatest(channelID)
        XCTAssertTrue(other.expandedThreadIDs.isEmpty)
        await store.shutDown(); await restored.shutDown(); await other.shutDown()
        XCTAssertTrue(restored.expandedThreadIDs.isEmpty)
    }

    func testLegacySnapshotDefaultsToCollapsedThreadsWithoutLosingHistory() throws {
        let original = ChatSnapshot(messages: [channelID: [service().root]])
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        object.removeValue(forKey: "expandedThreadIDs")
        let decoded = try JSONDecoder().decode(ChatSnapshot.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertTrue(decoded.expandedThreadIDs.isEmpty)
        XCTAssertEqual(decoded.messages[channelID]?.first?.id, "root")
    }
}

@MainActor
private final class InlineMessagingService: MessagingService {
    var root: ChatMessage
    var replies: [ChatMessage]
    var threadReads = 0
    var sendHandler: ((ChatMessage) async throws -> ChatMessage)?
    init(root: ChatMessage, replies: [ChatMessage]) { self.root = root; self.replies = replies }
    func channels(cursor: String?) async throws -> ChannelPage { ChannelPage(items: [Channel(id: root.channelID)]) }
    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage { MessagePage(items: [root]) }
    func thread(channelID: String, rootID: String) async throws -> ChannelThread {
        threadReads += 1
        return ChannelThread(root: root, replies: replies, state: MessageThreadState(rootID: rootID, userID: root.senderID, createdAt: root.createdAt, updatedAt: root.updatedAt))
    }
    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage { throw MessagingError.invalidResponse }
    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment], threadID: String?) async throws -> ChatMessage {
        let date = MessageDate.string(Date())
        let message = ChatMessage(id: nonce, parent: MessageParent(id: channelID), senderID: root.senderID,
            content: content, createdAt: date, updatedAt: date, threadID: threadID, attachments: attachments, nonce: nonce)
        if let sendHandler { return try await sendHandler(message) }
        return message
    }
    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage { root }
    func userNames(userIDs: [String]) async throws -> [String: String] { [:] }
}
