import XCTest
@testable import MacroNative

final class ChannelTimelineTests: XCTestCase {
    func testCollapsedThreadIncludesFirstThreeThenExpandsLatestInOrder() {
        var root = message("root", at: 0)
        let replies = (1...6).map { message("reply-\($0)", at: $0, thread: "root") }
        root.thread = .init(replyCount: 6, preview: replies)
        let collapsed = ChannelTimelineEntry.make(messages: [root], expanded: [], replyingTo: nil)
        XCTAssertEqual(collapsed.map(\.id), ["root", "reply-1", "reply-2", "reply-3", "thread-footer:root"])
        XCTAssertEqual(collapsed.last?.hiddenCount, 3)
        let expanded = ChannelTimelineEntry.make(messages: [root], expanded: ["root"], replyingTo: nil)
        XCTAssertEqual(expanded.map(\.id), ["root"] + replies.map(\.id) + ["thread-footer:root"])
        XCTAssertEqual(expanded.last?.hiddenCount, 0)
    }

    func testGroupingMatchesFiveMinuteWindowAndThreadBoundaries() {
        let first = message("first", at: 0)
        XCTAssertTrue(ChannelTimelineEntry.shouldGroup(message("next", at: 300), previous: first))
        XCTAssertFalse(ChannelTimelineEntry.shouldGroup(message("late", at: 301), previous: first))
        XCTAssertFalse(ChannelTimelineEntry.shouldGroup(message("earlier", at: -1), previous: first))
        var threaded = first; threaded.thread = .init(replyCount: 1)
        XCTAssertFalse(ChannelTimelineEntry.shouldGroup(message("next", at: 1), previous: threaded))
        var deleted = first; deleted.deletedAt = first.createdAt
        XCTAssertFalse(ChannelTimelineEntry.shouldGroup(message("next", at: 1), previous: deleted))
        var bot1 = first; bot1.sender = .init(type: "bot", id: "bot", triggeredBy: "alice")
        var bot2 = message("next", at: 1); bot2.sender = .init(type: "bot", id: "bot", triggeredBy: "bob")
        XCTAssertFalse(ChannelTimelineEntry.shouldGroup(bot2, previous: bot1))
    }

    private func message(_ id: String, at seconds: Int, thread: String? = nil) -> ChatMessage {
        let date = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 1_790_000_000 + Double(seconds)))
        return ChatMessage(id: id, parent: .init(id: "channel"), senderID: "user", content: "Message", createdAt: date, updatedAt: date, threadID: thread)
    }
}
