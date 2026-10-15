import XCTest
@testable import MacroNative

final class NativeChannelRoutingTests: XCTestCase {
    private let user = "macro|me@example.com"

    func testUncachedSoupChannelKeepsExplicitNonmembershipAndTitle() throws {
        let item = try WorkspaceItem.soup(.object(["tag": .string("channel"), "data": .object([
            "channel": .object(["id": .string("not-in-first-page"), "name": .string("Research"), "channel_type": .string("public")]),
            "is_participant": .bool(false), "participants": .array([.object(["user_id": .string(user)])]),
        ])]))
        let route = try XCTUnwrap(NativeChannelRoute(item: item, userID: user))
        XCTAssertEqual(route.channel.id, "not-in-first-page")
        XCTAssertEqual(route.channel.name, "Research")
        XCTAssertFalse(route.channel.isParticipant, "An explicit permission value takes precedence over a participant preview.")
        XCTAssertTrue(route.hasMetadata)
    }

    func testMessageSearchUsesChannelIDAndRequiresMembershipLookup() throws {
        let item = try WorkspaceItem.search(.object([
            "id": .string("parent-channel"), "message_id": .string("reply-message"), "type": .string("channelMessage"),
            "channel_id": .string("parent-channel"), "channel_name": .string("Engineers"),
            "metadata": .object(["channelType": .string("private")]),
        ]))
        XCTAssertEqual(item.id, "reply-message")
        let route = try XCTUnwrap(NativeChannelRoute(item: item, userID: user))
        XCTAssertEqual(route.channel.id, "parent-channel")
        XCTAssertEqual(route.channel.name, "Engineers")
        XCTAssertEqual(route.channel.channelType, "private")
        XCTAssertFalse(route.channel.isParticipant)
        XCTAssertFalse(route.hasMembership, "Search results must not grant composer access merely because they exist.")
        XCTAssertEqual(NativeChannelRoute.target(for: item), .init(messageID: "reply-message", threadID: nil))
        XCTAssertFalse(NativeChannelRoute.needsNotificationTarget(item), "A content search hit must never jump to an unrelated notification.")
    }

    func testSoupThreadTargetsItsRootAndUsesDrivingReplyWhenAvailable() throws {
        let item = try WorkspaceItem.soup(.object(["tag": .string("channelThread"), "data": .object([
            "id": .string("root"), "channel_id": .string("channel"), "content": .string("Thread root"),
            "thread": .object(["reply_count": .number(8), "preview": .array([])]),
        ])]))
        XCTAssertEqual(NativeChannelRoute.target(for: item), .init(messageID: "root", threadID: "root"))
        XCTAssertTrue(NativeChannelRoute.needsNotificationTarget(item))
        let notifications = [notification("old", message: "first-reply", thread: "root", created: "2026-01-01T10:00:00Z"),
            notification("new", message: "latest-reply", thread: "root", created: "2026-01-02T10:00:00Z", state: "seen"),
            notification("other-thread", message: "unrelated", thread: "different", created: "2026-01-03T10:00:00Z")]
        XCTAssertEqual(NativeChannelRoute.target(for: item, notifications: notifications), .init(messageID: "latest-reply", threadID: "root"))
    }

    func testStampedTargetAndSearchHitWinOverNotificationAndLatestPreview() throws {
        let item = try WorkspaceItem.search(.object([
            "type": .string("channelMessage"), "id": .string("channel"), "channel_id": .string("channel"),
            "message_id": .string("hit"), "thread_id": .string("root"),
            "target": .object(["messageId": .string("explicit"), "threadId": .string("explicit-root")]),
        ]))
        XCTAssertEqual(NativeChannelRoute.target(for: item, notifications: [notification("n", message: "newer", thread: "root")]),
            .init(messageID: "explicit", threadID: "explicit-root"))
        var unstamped = item; var payload = item.payload.object!; payload["target"] = nil; unstamped.payload = .object(payload)
        XCTAssertEqual(NativeChannelRoute.target(for: unstamped), .init(messageID: "hit", threadID: "root"))
    }

    func testGroupedLegacySearchTargetsFirstContentHitAndNameOnlyOpensLatest() throws {
        var item = try WorkspaceItem.search(.object([
            "type": .string("channel"), "id": .string("channel"), "channel_id": .string("channel"),
            "channel_message_search_results": .array([.object(["message_id": .null]),
                .object(["message_id": .string("hit"), "thread_id": .string("root")])]),
        ]))
        XCTAssertEqual(NativeChannelRoute.target(for: item), .init(messageID: "hit", threadID: "root"))
        item.payload = .object(["latest_message": .object(["message_id": .string("latest")])])
        XCTAssertNil(NativeChannelRoute.target(for: item), "A channel-name hit has no explicit message navigation target.")
    }

    func testWholeChannelIgnoresReadNotificationsAndThreadStacks() {
        var item = WorkspaceItem(id: "channel", kind: .channel, title: "Engineers", isUnread: true, entityType: "channel")
        let notifications = [notification("read", message: "read-message", tag: "channel_message_send", state: "seen"),
            notification("reply", message: "reply", thread: "root"),
            notification("mention", message: "mentioned-root", tag: "channel_mention"),
            notification("send", message: "top-level", tag: "channel_message_send")]
        XCTAssertEqual(NativeChannelRoute.target(for: item, notifications: notifications), .init(messageID: "top-level", threadID: nil))
        XCTAssertNil(NativeChannelRoute.target(for: item, notifications: Array(notifications.prefix(3))))
        item.isUnread = false
        XCTAssertFalse(NativeChannelRoute.needsNotificationTarget(item))
    }

    func testNonchannelNeverUsesCoincidentalMessageIDs() {
        let item = WorkspaceItem(id: "email-thread", kind: .email, title: "Email", entityType: "email_thread",
            payload: .object(["messageId": .string("email-message")]))
        XCTAssertNil(NativeChannelRoute.target(for: item))
    }

    private func notification(_ id: String, message: String, thread: String? = nil, tag: String = "channel_message_reply",
        created: String = "2026-01-01T12:00:00Z", state: String = "unseen") -> WorkspaceNotification {
        var content: [String: WorkspaceJSON] = ["messageId": .string(message)]
        if let thread { content["threadId"] = .string(thread) }
        return WorkspaceNotification(id: id, entityID: "channel", entityType: "channel", eventType: tag, senderID: nil,
            createdAt: created, state: state, metadata: .object(["tag": .string(tag), "content": .object(content)]))
    }

    func testThreadWithoutChannelIDCannotNavigateToItsMessageIDAsChannel() {
        let item = WorkspaceItem(id: "thread-root", kind: .channel, title: "Message", entityType: "channel_message")
        XCTAssertNil(NativeChannelRoute.channelID(for: item))
        XCTAssertNil(NativeChannelRoute(item: item, userID: user))
    }

    func testParticipantMetadataSupportsCamelCaseAndUnknownRemainsReadOnly() throws {
        let item = WorkspaceItem(id: "dm", kind: .channel, title: "Jamie", entityType: "channel", payload: .object([
            "channelType": .string("direct_message"), "participants": .array([
                .object(["userId": .string(user), "role": .string("owner")]),
                .object(["userId": .string("macro|jamie@example.com")]),
            ]),
        ]))
        let route = try XCTUnwrap(NativeChannelRoute(item: item, userID: user))
        XCTAssertTrue(route.channel.isParticipant); XCTAssertTrue(route.hasMetadata)
        XCTAssertEqual(route.channel.participants.count, 2)
        XCTAssertEqual(route.channel.participants.first?.role, "owner")
        let unknown = try XCTUnwrap(NativeChannelRoute(item: WorkspaceItem(id: "unknown", kind: .channel, title: "Conversation"), userID: user))
        XCTAssertFalse(unknown.hasMetadata); XCTAssertFalse(unknown.channel.isParticipant)
    }

    func testDedicatedMetadataResponseIgnoresLegacyTimelineAndDerivesMembership() throws {
        let data = Data(#"{"channel_id":"private","channel_name":"Engineers","channel_type":"private","participants":[{"user_id":"macro|me@example.com","role":"member","joined_at":"2026-01-01T00:00:00Z"}],"messages":[{"legacy_field":"not a modern message"}]}"#.utf8)
        let metadata = try JSONDecoder().decode(NativeChannelMetadata.self, from: data)
        let channel = metadata.channel(for: user)
        XCTAssertEqual(channel.id, "private"); XCTAssertEqual(channel.name, "Engineers")
        XCTAssertTrue(channel.isParticipant)
        XCTAssertFalse(metadata.channel(for: "someone-else").isParticipant)
        XCTAssertNil(channel.latestMessage)
    }
}
