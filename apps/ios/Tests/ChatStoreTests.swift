import XCTest
@testable import MacroNative

@MainActor
final class ChatStoreTests: XCTestCase {
    private let channelID = "channel-under-test"
    private let userID = "macro|sender@example.com"

    func testSendAppearsImmediatelyAndClearsOnlyItsDraft() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        store.setDraft("  Hello native!  ", channelID: channelID)
        store.setDraft("Keep this draft", channelID: "other-channel")

        let id = try XCTUnwrap(store.send("  Hello native!  ", channelID: channelID))

        XCTAssertEqual(store.messages[channelID]?.map(\.id), [id])
        XCTAssertEqual(store.messages[channelID]?.first?.content, "Hello native!")
        XCTAssertEqual(store.messages[channelID]?.first?.nonce, id)
        XCTAssertEqual(store.pending[id], .sending)
        XCTAssertEqual(store.drafts[channelID], "")
        XCTAssertEqual(store.drafts["other-channel"], "Keep this draft")
        XCTAssertTrue(api.sendRequests.isEmpty, "The optimistic update must happen before network work starts.")

        try await eventually { api.sendRequests.count == 1 }
        let confirmed = try XCTUnwrap(store.messages[channelID]?.first)
        api.completeSend(.success(confirmed))
        try await eventually { store.pending[id] == nil }
        XCTAssertEqual(store.messages[channelID]?.count, 1)
    }

    func testFailedSendRetainsMessageAndRetryUsesTheSameID() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let id = try XCTUnwrap(store.send("Please keep me", channelID: channelID))
        try await eventually { api.sendRequests.count == 1 }

        api.completeSend(.failure(URLError(.notConnectedToInternet)))
        try await eventually { store.pending[id] == .failed }
        let failed = try XCTUnwrap(store.messages[channelID]?.first)
        XCTAssertEqual(failed.content, "Please keep me")
        XCTAssertEqual(store.drafts[channelID], "")

        store.retry(failed)
        store.retry(failed)
        XCTAssertEqual(store.pending[id], .sending)
        try await eventually { api.sendRequests.count == 2 }
        XCTAssertEqual(api.sendRequests.map(\.nonce), [id, id])
        XCTAssertEqual(api.sendRequests.map(\.content), ["Please keep me", "Please keep me"])

        api.completeSend(.success(failed))
        try await eventually { store.pending[id] == nil }
        XCTAssertEqual(store.messages[channelID]?.map(\.id), [id])
    }

    func testAttachmentOnlySendAppearsImmediatelyAndRetriesOriginalAttachments() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let attachment = MessageAttachment(id: "local-file", entityID: "document-id", entityType: "document")
        let selection = ChannelDraftAttachment(attachment: attachment, title: "Launch plan")
        store.setDraftAttachments([selection], channelID: channelID)
        store.setDraftAttachments([selection], channelID: "other-channel")
        let id = try XCTUnwrap(store.send(" \n ", channelID: channelID, attachments: [attachment]))
        XCTAssertEqual(store.messages[channelID]?.first?.content, "")
        XCTAssertEqual(store.messages[channelID]?.first?.attachments.first?.entityID, "document-id")
        XCTAssertNil(store.draftAttachments[channelID])
        XCTAssertEqual(store.draftAttachments["other-channel"]?.first?.title, "Launch plan")
        try await eventually { api.sendRequests.count == 1 }
        api.completeSend(.failure(URLError(.notConnectedToInternet)))
        try await eventually { store.pending[id] == .failed }
        let failed = try XCTUnwrap(store.messages[channelID]?.first)
        store.retry(failed)
        try await eventually { api.sendRequests.count == 2 }
        XCTAssertEqual(api.sendRequests.map(\.nonce), [id, id])
        XCTAssertEqual(api.sendRequests.map { $0.attachments.first?.entityID }, ["document-id", "document-id"])
        var confirmed = failed; confirmed.attachments[0].id = "server-attachment-id"
        api.completeSend(.success(confirmed))
        try await eventually { store.pending[id] == nil }
        XCTAssertEqual(store.messages[channelID]?.count, 1)
        XCTAssertEqual(store.messages[channelID]?.first?.attachments.first?.id, "server-attachment-id")
    }

    func testPartialServerIDRekeyRetainsAttachmentsUntilCanonicalAcknowledgement() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let attachment = MessageAttachment(id: "optimistic-file", entityID: "document-id", entityType: "document")
        let localID = try XCTUnwrap(store.send("", channelID: channelID, attachments: [attachment]))
        try await eventually { api.sendRequests.count == 1 }
        var legacy = try XCTUnwrap(store.messages[channelID]?.first)
        legacy.id = "server-message"; legacy.nonce = localID; legacy.attachments = []; legacy.isPartial = true
        store.receive(event(legacy))
        XCTAssertEqual(store.messages[channelID]?.map(\.id), [legacy.id])
        XCTAssertEqual(store.messages[channelID]?.first?.attachments.first?.entityID, "document-id")
        var canonical = legacy; canonical.isPartial = nil; canonical.attachments = [attachment]
        canonical.attachments[0].id = "server-file"
        api.completeSend(.success(canonical))
        try await eventually { api.completedSends == 1 }
        await Task.yield()
        XCTAssertEqual(store.messages[channelID]?.first?.attachments.first?.id, "server-file")
    }

    func testAttachmentDraftSelectionPersistsAndOldCacheSchemaStillDecodes() async throws {
        let old = Data(#"{"channels":[],"messages":{},"drafts":{},"pending":{},"names":{}}"#.utf8)
        XCTAssertNil(try JSONDecoder().decode(ChatSnapshot.self, from: old).draftAttachments)
        let cache = ChatDiskCache(account: "test-attachment-draft-\(UUID().uuidString)")
        addTeardownBlock { await cache.clear() }
        let selection = ChannelDraftAttachment(attachment: MessageAttachment(id: "local", entityID: "doc", entityType: "document"), title: "Plan")
        let api = ControlledMessagingService()
        let first = ChatStore(api: api, userID: userID, cache: cache)
        first.setDraftAttachments([selection], channelID: channelID)
        first.suspend()
        try await eventually { await cache.read()?.draftAttachments?[self.channelID]?.first?.title == "Plan" }
        let restored = ChatStore(api: api, userID: userID, cache: cache)
        await restored.start()
        XCTAssertEqual(restored.draftAttachments[channelID]?.first?.attachment.entityID, "doc")
        await restored.shutDown()
        XCTAssertTrue(restored.draftAttachments.isEmpty)
    }

    func testSocketAcknowledgementWinsOverLaterHTTPFailure() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let id = try XCTUnwrap(store.send("Acknowledged", channelID: channelID))
        try await eventually { api.sendRequests.count == 1 }
        var confirmed = try XCTUnwrap(store.messages[channelID]?.first)
        confirmed.updatedAt = MessageDate.string(Date().addingTimeInterval(1))

        store.receive(event(confirmed))
        XCTAssertNil(store.pending[id])
        api.completeSend(.failure(URLError(.timedOut)))
        try await eventually { api.completedSends == 1 }
        await Task.yield()

        XCTAssertNil(store.pending[id], "An acknowledged message must not become failed after an HTTP timeout.")
        XCTAssertEqual(store.messages[channelID]?.map(\.id), [id])
    }

    func testAuthoritativeAcknowledgementReplacesOptimisticMessageDespiteClockSkew() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let id = try XCTUnwrap(store.send("Phone timestamp", channelID: channelID))
        try await eventually { api.sendRequests.count == 1 }
        var confirmed = try XCTUnwrap(store.messages[channelID]?.first)
        confirmed.createdAt = "2025-01-01T10:00:00.000Z"
        confirmed.updatedAt = confirmed.createdAt

        store.receive(event(confirmed))
        XCTAssertNil(store.pending[id])
        XCTAssertEqual(store.messages[channelID]?.first?.createdAt, confirmed.createdAt)
        api.completeSend(.success(confirmed))
        try await eventually { api.completedSends == 1 }
        await Task.yield()
        XCTAssertEqual(store.messages[channelID]?.first?.createdAt, confirmed.createdAt)
    }

    func testRepeatedSocketHTTPAndHistoryAcknowledgementsAreDeduplicated() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let id = try XCTUnwrap(store.send("Exactly one bubble", channelID: channelID))
        try await eventually { api.sendRequests.count == 1 }
        var confirmed = try XCTUnwrap(store.messages[channelID]?.first)
        confirmed.updatedAt = MessageDate.string(Date().addingTimeInterval(1))

        store.receive(event(confirmed))
        store.receive(event(confirmed))
        api.completeSend(.success(confirmed))
        try await eventually { api.completedSends == 1 }
        api.messagePages = [MessagePage(items: [confirmed, confirmed])]
        await store.loadLatest(channelID)

        XCTAssertEqual(store.messages[channelID]?.map(\.id), [id])
        XCTAssertNil(store.pending[id])
    }

    func testHTTPServerAssignedIDReplacesOptimisticIDWithoutLeavingASecondMessage() async throws {
        let api = ControlledMessagingService()
        api.channelPage = ChannelPage(items: [Channel(id: channelID, name: "Assigned ID")])
        let store = ChatStore(api: api, userID: userID)
        await store.refreshChannels()
        let localID = try XCTUnwrap(store.send("Server-assigned identifier", channelID: channelID))
        try await eventually { api.sendRequests.count == 1 }
        var confirmed = try XCTUnwrap(store.messages[channelID]?.first)
        confirmed.id = "server-assigned-message"
        confirmed.nonce = nil

        api.completeSend(.success(confirmed))
        try await eventually { store.pending[localID] == nil }

        XCTAssertEqual(store.messages[channelID]?.map(\.id), [confirmed.id])
        XCTAssertEqual(store.messages[channelID]?.first?.nonce, localID)
        XCTAssertEqual(store.channels.first?.latestMessage?.messageID, confirmed.id)
        XCTAssertNil(store.deliveryErrors[localID])
    }

    func testSocketServerAssignedIDReplacesOptimisticIDBeforeHTTPTimeout() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let localID = try XCTUnwrap(store.send("Confirmed through socket", channelID: channelID))
        try await eventually { api.sendRequests.count == 1 }
        var confirmed = try XCTUnwrap(store.messages[channelID]?.first)
        confirmed.id = "socket-assigned-message"
        confirmed.nonce = nil

        let acknowledgement = MessageEvent(parent: confirmed.parent, actor: userID, nonce: localID,
            change: MessageChange(type: "posted", message: confirmed))
        store.receive(acknowledgement)
        store.receive(acknowledgement)
        XCTAssertEqual(store.messages[channelID]?.map(\.id), [confirmed.id])
        XCTAssertNil(store.pending[localID])
        api.completeSend(.failure(URLError(.timedOut)))
        try await eventually { api.completedSends == 1 }
        await Task.yield()

        XCTAssertEqual(store.messages[channelID]?.map(\.id), [confirmed.id])
        XCTAssertNil(store.pending[localID])
        XCTAssertNil(store.deliveryErrors[localID])
    }

    func testPaginationSortsChronologicallyAndDeduplicatesPageBoundaries() async throws {
        let api = ControlledMessagingService()
        let newest = message("newest", minute: 3)
        let middle = message("middle", minute: 2)
        let oldest = message("oldest", minute: 1)
        let cursor = MessageCursor(createdAt: middle.createdAt, id: middle.id)
        api.messagePages = [
            MessagePage(items: [newest, middle], nextCursor: cursor),
            MessagePage(items: [middle, oldest]),
        ]
        let store = ChatStore(api: api, userID: userID)

        await store.loadLatest(channelID)
        XCTAssertEqual(store.messages[channelID]?.map(\.id), [middle.id, newest.id])
        XCTAssertEqual(store.cursors[channelID], cursor)
        await store.loadOlder(channelID)

        XCTAssertEqual(store.messages[channelID]?.map(\.id), [oldest.id, middle.id, newest.id])
        XCTAssertEqual(api.messageRequests.map(\.cursor), [nil, cursor])
        XCTAssertNil(store.cursors[channelID])
        await store.loadOlder(channelID)
        XCTAssertEqual(api.messageRequests.count, 2, "An exhausted history must not be requested again.")
    }

    func testRefreshBridgesEveryPageMissedDuringDisconnection() async throws {
        let api = ControlledMessagingService()
        let original = message("original", minute: 1)
        let missed = message("missed", minute: 2)
        let newest = message("newest", minute: 3)
        let cursor = MessageCursor(createdAt: newest.createdAt, id: newest.id)
        api.messagePages = [MessagePage(items: [original])]
        let store = ChatStore(api: api, userID: userID)
        await store.loadLatest(channelID)

        api.messagePages = [
            MessagePage(items: [newest], nextCursor: cursor),
            MessagePage(items: [missed, original]),
        ]
        await store.loadLatest(channelID)

        XCTAssertEqual(store.messages[channelID]?.map(\.id), [original.id, missed.id, newest.id])
        XCTAssertEqual(api.messageRequests.map(\.cursor), [nil, nil, cursor])
    }

    func testStaleHistoryCannotOverwriteALiveEditOrDelete() async {
        let api = ControlledMessagingService()
        let original = message("edited-message", minute: 1)
        api.messagePages = [MessagePage(items: [original])]
        let store = ChatStore(api: api, userID: userID)
        await store.loadLatest(channelID)
        var edited = original
        edited.content = "Latest content"
        edited.updatedAt = "2025-01-01T10:02:00.000Z"
        edited.editedAt = edited.updatedAt
        store.receive(event(edited, type: "edited"))
        api.messagePages = [MessagePage(items: [original])]
        await store.loadLatest(channelID)
        XCTAssertEqual(store.messages[channelID]?.first?.content, "Latest content")

        var deleted = edited
        deleted.updatedAt = "2025-01-01T10:03:00.000Z"
        deleted.deletedAt = deleted.updatedAt
        store.receive(event(deleted, type: "message_deleted"))
        api.messagePages = [MessagePage(items: [edited])]
        await store.loadLatest(channelID)
        XCTAssertEqual(store.messages[channelID]?.first?.deletedAt, deleted.deletedAt)
    }

    func testStaleSocketEventCannotRegressChannelPreviewAfterLiveEdit() async {
        let api = ControlledMessagingService()
        let original = message("preview-message", minute: 1)
        api.channelPage = ChannelPage(items: [Channel(
            id: channelID, name: "Preview", latestMessage: ChannelPreview(
                messageID: original.id, content: original.content,
                senderID: original.senderID, createdAt: original.createdAt
            )
        )])
        api.messagePages = [MessagePage(items: [original])]
        let store = ChatStore(api: api, userID: userID)
        await store.refreshChannels()
        await store.loadLatest(channelID)
        var edited = original
        edited.content = "Current preview"
        edited.updatedAt = "2025-01-01T10:02:00.000Z"
        edited.editedAt = edited.updatedAt

        store.receive(event(edited, type: "edited"))
        store.receive(event(original))

        XCTAssertEqual(store.messages[channelID]?.first?.content, "Current preview")
        XCTAssertEqual(store.channels.first?.preview, "Current preview")
    }

    func testLiveMessageWithoutTimelineMetadataPreservesReplyCountAndThreadState() async {
        let api = ControlledMessagingService()
        var original = message("root-message", minute: 1)
        original.thread = MessageThreadPreview(replyCount: 3)
        original.state = MessageThreadState(rootID: original.id, userID: userID,
            createdAt: original.createdAt, updatedAt: original.updatedAt, resolved: true)
        api.messagePages = [MessagePage(items: [original])]
        let store = ChatStore(api: api, userID: userID)
        await store.loadLatest(channelID)
        var changed = original
        changed.content = "Edited root"
        changed.updatedAt = "2025-01-01T10:02:00.000Z"
        changed.thread = nil
        changed.state = nil

        store.receive(event(changed, type: "edited"))

        XCTAssertEqual(store.messages[channelID]?.first?.content, "Edited root")
        XCTAssertEqual(store.messages[channelID]?.first?.replyCount, 3)
        XCTAssertEqual(store.messages[channelID]?.first?.state?.resolved, true)
    }

    func testLateLegacyEchoPreservesCanonicalAttachmentsReactionsAndMentions() async {
        let api = ControlledMessagingService()
        var original = message("rich-message", minute: 1)
        original.attachments = [MessageAttachment(id: "attachment", entityID: "document", entityType: "document")]
        original.reactions = [MessageReaction(emoji: "👍", users: [userID])]
        original.mentions = [MessageMention(entityID: userID, entityType: "user")]
        api.messagePages = [MessagePage(items: [original])]
        let store = ChatStore(api: api, userID: userID)
        await store.loadLatest(channelID)
        var legacy = original
        legacy.attachments = []
        legacy.reactions = []
        legacy.mentions = []
        legacy.isPartial = true

        store.receive(event(legacy))

        XCTAssertEqual(store.messages[channelID]?.first?.attachments.map(\.id), ["attachment"])
        XCTAssertEqual(store.messages[channelID]?.first?.reactions.first?.users, [userID])
        XCTAssertEqual(store.messages[channelID]?.first?.mentions.first?.entityID, userID)
    }

    func testWhitespaceDraftDoesNotSendOrEraseTheDraft() {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        store.setDraft(" \n ", channelID: channelID)

        XCTAssertNil(store.send(" \n ", channelID: channelID))
        XCTAssertEqual(store.drafts[channelID], " \n ")
        XCTAssertTrue(store.pending.isEmpty)
        XCTAssertTrue(api.sendRequests.isEmpty)
    }

    func testLateSendCompletionCannotRepopulateSignedOutStore() async throws {
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID)
        _ = store.send("Signing out", channelID: channelID)
        try await eventually { api.sendRequests.count == 1 }
        let confirmed = try XCTUnwrap(store.messages[channelID]?.first)

        await store.shutDown()
        api.completeSend(.success(confirmed))
        try await eventually { api.completedSends == 1 }
        await Task.yield()

        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertTrue(store.pending.isEmpty)
        XCTAssertTrue(store.drafts.isEmpty)
    }

    func testDiskCachesAreSeparatedByAccountAndShutdownClearsOnlyCurrentAccount() async throws {
        let accountSuffix = UUID().uuidString
        let firstCache = ChatDiskCache(account: "test-a-\(accountSuffix)")
        let secondCache = ChatDiskCache(account: "test-b-\(accountSuffix)")
        addTeardownBlock {
            await firstCache.clear()
            await secondCache.clear()
        }
        let firstSnapshot = ChatSnapshot(drafts: [channelID: "First account draft"])
        let secondSnapshot = ChatSnapshot(drafts: [channelID: "Second account draft"])
        await firstCache.write(firstSnapshot)
        let initiallyEmpty = await secondCache.read()
        XCTAssertNil(initiallyEmpty)
        await secondCache.write(secondSnapshot)
        let api = ControlledMessagingService()
        let store = ChatStore(api: api, userID: userID, cache: firstCache)

        await store.start()
        XCTAssertEqual(store.drafts[channelID], "First account draft")
        await store.shutDown()
        let firstAfterShutdown = await firstCache.read()
        let secondAfterShutdown = await secondCache.read()
        XCTAssertNil(firstAfterShutdown)
        XCTAssertEqual(secondAfterShutdown?.drafts[channelID], "Second account draft")
    }

    func testHistoryCacheRetainsFailedSendsBeyondTheRecentMessageLimit() async throws {
        let api = ControlledMessagingService()
        let cache = ChatDiskCache(account: "test-outbox-\(UUID().uuidString)")
        let store = ChatStore(api: api, userID: userID, cache: cache)
        addTeardownBlock { await store.shutDown() }
        let id = try XCTUnwrap(store.send("Keep this failed send", channelID: channelID))
        try await eventually { api.sendRequests.count == 1 }
        api.completeSend(.failure(URLError(.notConnectedToInternet)))
        try await eventually { store.pending[id] == .failed }

        for index in 1...301 {
            let date = MessageDate.string(Date().addingTimeInterval(Double(index)))
            let incoming = ChatMessage(id: "confirmed-\(index)", parent: MessageParent(id: channelID),
                senderID: userID, content: "Message \(index)", createdAt: date, updatedAt: date)
            store.receive(event(incoming))
        }
        store.suspend()
        try await eventually {
            let snapshot = await cache.read()
            return snapshot?.messages[self.channelID]?.count == 301
        }
        let snapshot = await cache.read()
        XCTAssertEqual(snapshot?.pending[id], .failed)
        XCTAssertTrue(snapshot?.messages[channelID]?.contains(where: { $0.id == id }) == true)
        XCTAssertTrue(snapshot?.messages[channelID]?.contains(where: { $0.id == "confirmed-301" }) == true)
        XCTAssertFalse(snapshot?.messages[channelID]?.contains(where: { $0.id == "confirmed-1" }) == true)
    }

    private func message(_ id: String, minute: Int) -> ChatMessage {
        let date = String(format: "2025-01-01T10:%02d:00.000Z", minute)
        return ChatMessage(id: id, parent: MessageParent(id: channelID), senderID: userID,
                           content: id, createdAt: date, updatedAt: date)
    }

    private func event(_ message: ChatMessage, type: String = "posted") -> MessageEvent {
        MessageEvent(parent: message.parent, actor: message.senderID, nonce: message.nonce,
                     change: MessageChange(type: type, message: message))
    }

    private func eventually(
        file: StaticString = #filePath, line: UInt = #line, _ condition: () async -> Bool
    ) async throws {
        let deadline = ContinuousClock.now + .seconds(2)
        while !(await condition()) && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(1))
        }
        guard await condition() else {
            XCTFail("The expected asynchronous state did not arrive.", file: file, line: line)
            throw TestTimeout()
        }
    }
}

private struct TestTimeout: Error {}

@MainActor
private final class ControlledMessagingService: MessagingService {
    struct SendRequest {
        let channelID: String
        let content: String
        let nonce: String
        let attachments: [MessageAttachment]
    }
    struct MessageRequest {
        let channelID: String
        let cursor: MessageCursor?
    }

    var channelPage = ChannelPage(items: [])
    var messagePages: [MessagePage] = []
    private(set) var sendRequests: [SendRequest] = []
    private(set) var messageRequests: [MessageRequest] = []
    private(set) var completedSends = 0
    private var sends: [CheckedContinuation<ChatMessage, Error>] = []

    func channels(cursor: String?) async throws -> ChannelPage { channelPage }

    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage {
        messageRequests.append(MessageRequest(channelID: channelID, cursor: cursor))
        guard !messagePages.isEmpty else { throw MessagingError.invalidResponse }
        return messagePages.removeFirst()
    }

    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage {
        try await send(channelID: channelID, content: content, nonce: nonce, attachments: [])
    }

    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment]) async throws -> ChatMessage {
        sendRequests.append(SendRequest(channelID: channelID, content: content, nonce: nonce, attachments: attachments))
        defer { completedSends += 1 }
        return try await withCheckedThrowingContinuation { sends.append($0) }
    }

    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage {
        throw MessagingError.invalidResponse
    }

    func userNames(userIDs: [String]) async throws -> [String: String] { [:] }

    func completeSend(_ result: Result<ChatMessage, Error>, file: StaticString = #filePath, line: UInt = #line) {
        guard !sends.isEmpty else {
            XCTFail("No send request is waiting for a response.", file: file, line: line)
            return
        }
        sends.removeFirst().resume(with: result)
    }
}
