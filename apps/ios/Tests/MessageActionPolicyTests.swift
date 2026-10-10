import XCTest
@testable import MacroNative

final class MessageActionPolicyTests: XCTestCase {
    private func message(sender: String = "macro|me", threadID: String? = nil) -> ChatMessage {
        ChatMessage(id: "message", parent: MessageParent(id: "channel"), senderID: sender,
            content: "Follow up on the mobile launch", createdAt: "2026-09-27T12:00:00Z", updatedAt: "2026-09-27T12:00:00Z", threadID: threadID)
    }
    func testMessageAndBotActionsMatchChannelOwnershipAndWriteAccess() {
        let own = message(), other = message(sender: "macro|other"), bot = message(sender: "bot|agent")
        XCTAssertTrue(NativeMessageActionPolicy.canEdit(own, userID: "macro|me", canWrite: true))
        XCTAssertFalse(NativeMessageActionPolicy.canEdit(bot, userID: "macro|me", canWrite: true))
        XCTAssertTrue(NativeMessageActionPolicy.canDelete(bot, userID: "macro|me", canWrite: true))
        XCTAssertFalse(NativeMessageActionPolicy.canDelete(other, userID: "macro|me", canWrite: true))
        XCTAssertFalse(NativeMessageActionPolicy.canDelete(own, userID: "macro|me", canWrite: false))
        var deleted = own; deleted.deletedAt = own.updatedAt
        XCTAssertFalse(NativeMessageActionPolicy.canEdit(deleted, userID: "macro|me", canWrite: true))
        XCTAssertFalse(NativeMessageActionPolicy.canDelete(deleted, userID: "macro|me", canWrite: true))
    }
    func testCopiedMessageLinkRetainsThreadAndMessageNavigation() throws {
        let url = NativeMessageActionPolicy.link(message(threadID: "root"), webURL: URL(string: "https://macro.com/app")!)
        XCTAssertEqual(url.path, "/app/channel/channel")
        let query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(query.first { $0.name == "channel_message_id" }?.value, "message")
        XCTAssertEqual(query.first { $0.name == "channel_thread_id" }?.value, "root")
    }
    func testCreatedTaskKeepsCanonicalSourceMessageReference() throws {
        let wire = NativeMessageActionPolicy.taskReference(message(threadID: "root"), channelName: "Launch <review>")
        let token = try XCTUnwrap(MentionCodec.tokens(in: wire).first?.token)
        XCTAssertEqual(token.kind, .channel); XCTAssertEqual(token.title, "Launch <review>")
        XCTAssertTrue(wire.contains("channel_message_id")); XCTAssertTrue(wire.contains("channel_thread_id"))
        XCTAssertFalse(wire.contains("<review>"))
    }
}
