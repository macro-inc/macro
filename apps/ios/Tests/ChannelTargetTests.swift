import XCTest
@testable import MacroNative

@MainActor
final class ChannelTargetTests: XCTestCase {
    func testNotificationLoadsOldReplyAndExpandsItsParentWithoutPagingHistory() async throws {
        let api = TargetMessagingService()
        let store = ChatStore(api: api, userID: "me")
        let target = await store.loadTarget(channelID: "channel", messageID: "reply")
        XCTAssertEqual(target, "reply")
        XCTAssertTrue(store.expandedThreadIDs.contains("root"))
        XCTAssertEqual(store.messages["channel"]?.first?.thread?.preview.map(\.id), ["reply"])
        XCTAssertEqual(api.messageLookups, ["reply"])
        XCTAssertEqual(api.threadLookups, ["root"])
        XCTAssertEqual(api.pageRequests, 0, "A notification must not scan every older history page.")
    }

    func testTargetCannotMergeMessageFromAnotherChannel() async {
        let api = TargetMessagingService(); api.messageChannel = "another-channel"
        let store = ChatStore(api: api, userID: "me")
        let target = await store.loadTarget(channelID: "channel", messageID: "reply")
        XCTAssertNil(target)
        XCTAssertNil(store.messages["channel"])
        XCTAssertTrue(api.threadLookups.isEmpty)
    }
}

@MainActor private final class TargetMessagingService: MessagingService {
    var messageChannel = "channel"
    var messageLookups: [String] = []
    var threadLookups: [String] = []
    var pageRequests = 0
    private func message(_ id: String, thread: String? = nil) -> ChatMessage {
        .init(id: id, parent: .init(id: messageChannel), senderID: "author", content: id,
              createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", threadID: thread)
    }
    func channels(cursor: String?) async throws -> ChannelPage { .init(items: []) }
    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage { pageRequests += 1; return .init(items: []) }
    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage { messageLookups.append(messageID); return message(messageID, thread: "root") }
    func thread(channelID: String, rootID: String) async throws -> ChannelThread { threadLookups.append(rootID); return .init(root: message(rootID), replies: [message("reply", thread: rootID)], state: .init(rootID: rootID, userID: "me", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z")) }
    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage { throw MessagingError.invalidResponse }
    func userNames(userIDs: [String]) async throws -> [String: String] { [:] }
}
