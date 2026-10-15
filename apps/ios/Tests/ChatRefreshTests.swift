import XCTest
@testable import MacroNative

@MainActor
final class ChatRefreshTests: XCTestCase {
    private let channelID = "refresh-channel"
    private let userID = "macro|refresh@example.com"

    func testNewestPageIsVisibleWhileGapLoadsAndFailedGapResumesOnRetry() async throws {
        let api = RefreshMessagingService()
        let store = ChatStore(api: api, userID: userID)
        let original = message("original", minute: 1)
        let missed = message("missed", minute: 2)
        let newest = message("newest", minute: 3)
        let cursor = MessageCursor(createdAt: newest.createdAt, id: newest.id)
        store.receive(event(original))
        var bridge: CheckedContinuation<MessagePage, Error>?
        api.messageHandler = { requested in
            if requested == nil { return MessagePage(items: [newest], nextCursor: cursor) }
            return try await withCheckedThrowingContinuation { bridge = $0 }
        }
        let refresh = Task { await store.loadLatest(channelID) }
        try await eventually { bridge != nil }

        XCTAssertEqual(store.messages[channelID]?.map(\.id), [original.id, newest.id])
        XCTAssertEqual(store.cursors[channelID], cursor)
        XCTAssertTrue(store.loadingMessages.contains(channelID))
        bridge?.resume(throwing: URLError(.notConnectedToInternet))
        await refresh.value
        XCTAssertEqual(store.messages[channelID]?.map(\.id), [original.id, newest.id])
        XCTAssertNotNil(store.messageErrors[channelID])

        api.messageHandler = { requested in
            requested == nil ? MessagePage(items: [newest], nextCursor: cursor)
                : MessagePage(items: [missed, original])
        }
        await store.loadLatest(channelID)

        XCTAssertEqual(api.messageRequests, [nil, cursor, nil, cursor], "Already displaying the newest page must not hide an unfinished gap.")
        XCTAssertEqual(store.messages[channelID]?.map(\.id), [original.id, missed.id, newest.id])
        XCTAssertNil(store.cursors[channelID], "Finishing a retried gap must also advance its history cursor.")
        XCTAssertNil(store.messageErrors[channelID])
    }

    func testFirstPageRefreshPreservesLoadedLaterChannelsAndTheirPaginationCursor() async throws {
        let api = RefreshMessagingService()
        var pages = [
            ChannelPage(items: [Channel(id: "first")], nextCursor: "page-two"),
            ChannelPage(items: [Channel(id: "second")], nextCursor: "page-three"),
            ChannelPage(items: [Channel(id: "first", name: "Renamed")], nextCursor: "page-two"),
            ChannelPage(items: [Channel(id: "third")]),
        ]
        api.channelHandler = { _ in pages.removeFirst() }
        let store = ChatStore(api: api, userID: userID)
        await store.refreshChannels()
        await store.refreshChannels(more: true)
        await store.refreshChannels()

        XCTAssertEqual(Set(store.channels.map(\.id)), ["first", "second"])
        XCTAssertEqual(store.channels.first(where: { $0.id == "first" })?.name, "Renamed")
        XCTAssertEqual(store.nextChannelCursor, "page-three")
        await store.refreshChannels(more: true)
        XCTAssertEqual(api.channelRequests, [nil, "page-two", nil, "page-three"])
        XCTAssertEqual(Set(store.channels.map(\.id)), ["first", "second", "third"])
        XCTAssertNil(store.nextChannelCursor)
    }

    func testSlowChannelRefreshDoesNotOverwriteSameMessageEditedThroughSocket() async throws {
        let api = RefreshMessagingService()
        let original = message("edited", minute: 1)
        let channel = Channel(id: channelID, latestMessage: preview(original))
        api.channelHandler = { _ in ChannelPage(items: [channel]) }
        let store = ChatStore(api: api, userID: userID)
        await store.refreshChannels()
        var response: CheckedContinuation<ChannelPage, Error>?
        api.channelHandler = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let refresh = Task { await store.refreshChannels() }
        try await eventually { response != nil }
        var edited = original
        edited.content = "Live edited text"
        edited.updatedAt = "2025-01-01T10:02:00.000Z"
        store.receive(event(edited))
        response?.resume(returning: ChannelPage(items: [channel]))
        await refresh.value

        XCTAssertEqual(store.channels.first?.latestMessage?.content, edited.content)
        XCTAssertEqual(store.channels.first?.latestMessage?.updatedAt, edited.updatedAt)
    }

    func testExplicitAccessDenialClearsChannelHistoryAndDraft() async {
        for status in [403, 404] {
            let api = RefreshMessagingService()
            let channel = Channel(id: channelID)
            api.channelHandler = { _ in ChannelPage(items: [channel]) }
            api.messageHandler = { _ in throw MessagingError.http(status) }
            let store = ChatStore(api: api, userID: userID)
            await store.refreshChannels()
            store.receive(event(message("cached", minute: 1)))
            store.setDraft("No longer accessible", channelID: channelID)
            store.setDraft("Private thread draft", channelID: "thread:\(channelID):root")
            store.setDraft("Private thread outbox", channelID: "thread-outbox:\(channelID):root")
            store.setDraft("Unrelated draft", channelID: "thread:\(channelID)-other:root")

            XCTAssertTrue(store.canCompose(in: channel))
            await store.open(channel)

            XCTAssertTrue(store.isChannelInaccessible(channelID))
            XCTAssertFalse(store.canCompose(in: channel), "A screen retaining its original channel must disable composing after access is denied.")
            XCTAssertNil(store.send("Late send", channelID: channelID))
            XCTAssertTrue(store.channels.isEmpty)
            XCTAssertNil(store.messages[channelID])
            XCTAssertNil(store.drafts[channelID])
            XCTAssertNil(store.drafts["thread:\(channelID):root"])
            XCTAssertNil(store.drafts["thread-outbox:\(channelID):root"])
            XCTAssertEqual(store.drafts["thread:\(channelID)-other:root"], "Unrelated draft")
            store.receive(event(message("late-event", minute: 2)))
            store.setDraft("Late draft callback", channelID: "thread:\(channelID):root")
            XCTAssertNil(store.messages[channelID])
            XCTAssertNil(store.drafts["thread:\(channelID):root"])
            XCTAssertNil(store.selectedChannelID)
            XCTAssertNotNil(store.messageErrors[channelID])

            api.messageHandler = { _ in MessagePage(items: []) }
            await store.loadLatest(channelID)
            XCTAssertFalse(store.isChannelInaccessible(channelID))
            XCTAssertTrue(store.canCompose(in: channel), "A successful fresh history read can restore access.")
        }
    }

    func testSlowChannelListCannotRestorePreviewAfterAccessIsDenied() async throws {
        let api = RefreshMessagingService()
        let channel = Channel(id: channelID, latestMessage: preview(message("private-preview", minute: 1)))
        api.channelHandler = { _ in ChannelPage(items: [channel]) }
        let store = ChatStore(api: api, userID: userID)
        await store.refreshChannels()
        var response: CheckedContinuation<ChannelPage, Error>?
        api.channelHandler = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let refresh = Task { await store.refreshChannels() }
        try await eventually { response != nil }
        api.messageHandler = { _ in throw MessagingError.http(403) }
        await store.loadLatest(channelID)
        XCTAssertTrue(store.channels.isEmpty)

        response?.resume(returning: ChannelPage(items: [channel]))
        await refresh.value
        XCTAssertTrue(store.channels.isEmpty, "A list fetched before denial must not restore its cached channel preview.")
        XCTAssertTrue(store.isChannelInaccessible(channelID))

        api.channelHandler = { _ in ChannelPage(items: [channel]) }
        api.messageHandler = { _ in MessagePage(items: []) }
        await store.refreshChannels()
        XCTAssertEqual(store.channels.map(\.id), [channelID], "A later authorized list may rediscover restored access.")
        await store.loadLatest(channelID)
        XCTAssertTrue(store.canCompose(in: channel))
    }

    func testCompleteChannelInventoryCanRemoveMissingChannels() async {
        let api = RefreshMessagingService()
        var pages = [
            ChannelPage(items: [Channel(id: "retained"), Channel(id: "removed")]),
            ChannelPage(items: [Channel(id: "retained")]),
        ]
        api.channelHandler = { _ in pages.removeFirst() }
        let store = ChatStore(api: api, userID: userID)
        await store.refreshChannels()
        await store.refreshChannels()
        XCTAssertEqual(store.channels.map(\.id), ["retained"])
    }

    private func message(_ id: String, minute: Int) -> ChatMessage {
        let date = String(format: "2025-01-01T10:%02d:00.000Z", minute)
        return ChatMessage(id: id, parent: MessageParent(id: channelID), senderID: userID,
            content: id, createdAt: date, updatedAt: date)
    }

    private func preview(_ message: ChatMessage) -> ChannelPreview {
        ChannelPreview(messageID: message.id, content: message.content, senderID: message.senderID,
            createdAt: message.createdAt, updatedAt: message.updatedAt)
    }

    private func event(_ message: ChatMessage) -> MessageEvent {
        MessageEvent(parent: message.parent, actor: message.senderID, change: MessageChange(type: "posted", message: message))
    }

    private func eventually(_ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(2)
        while !condition(), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(1)) }
        XCTAssertTrue(condition(), "The expected asynchronous request did not start.")
    }
}

@MainActor
private final class RefreshMessagingService: MessagingService {
    var channelHandler: (String?) async throws -> ChannelPage = { _ in ChannelPage(items: []) }
    var messageHandler: (MessageCursor?) async throws -> MessagePage = { _ in MessagePage(items: []) }
    var channelRequests: [String?] = []
    var messageRequests: [MessageCursor?] = []

    func channels(cursor: String?) async throws -> ChannelPage {
        channelRequests.append(cursor)
        return try await channelHandler(cursor)
    }
    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage {
        messageRequests.append(cursor)
        return try await messageHandler(cursor)
    }
    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage { throw URLError(.notConnectedToInternet) }
    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage { throw MessagingError.invalidResponse }
    func userNames(userIDs: [String]) async throws -> [String: String] { [:] }
}
