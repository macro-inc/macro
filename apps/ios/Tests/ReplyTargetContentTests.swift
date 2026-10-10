import XCTest
@testable import MacroNative

final class ReplyTargetContentTests: XCTestCase {
    private let wire = #"<m-reply-target>{"parent":{"type":"channel","id":"channel-1"},"targetMessageId":"reply-1","targetThreadId":"thread-1","displayText":"Waiting for the review","senderId":"macro|jamie@example.com"}</m-reply-target>"#

    func testExactWebReplyTargetSplitsIntoNativeQuoteAndBody() throws {
        let parsed = ReplyTargetContent.split(wire + "\n\nYes, I’ll take a look.")
        let quote = try XCTUnwrap(parsed.quotes.first)
        XCTAssertEqual(parsed.body, "Yes, I’ll take a look.")
        XCTAssertEqual(quote.parent, .init(type: "channel", id: "channel-1"))
        XCTAssertEqual(quote.targetMessageId, "reply-1")
        XCTAssertEqual(quote.targetThreadId, "thread-1")
        XCTAssertEqual(quote.displayText, "Waiting for the review")
        XCTAssertEqual(quote.senderName(currentUserID: "me", names: ["macro|jamie@example.com": "Jamie Chen"]), "Jamie Chen")
        XCTAssertEqual(quote.wire, wire)
        XCTAssertTrue(MentionCodec.mentions(in: wire).isEmpty, "Quote metadata must not create extra notifications")
    }

    func testReplyActionRoundTripsChildTargetWithoutQuotingARoot() throws {
        var message = ChatMessage(id: "child", parent: MessageParent(id: "channel"), senderID: "macro|jamie@example.com",
            content: "A quoted \"phrase\"\n\nwith 👩🏽‍💻 & text", createdAt: "2026-09-27T12:00:00Z", updatedAt: "2026-09-27T12:00:00Z", threadID: "root")
        let wire = try XCTUnwrap(ReplyTargetContent.wire(for: message))
        let parsed = ReplyTargetContent.split(wire + "\n\nMy response")
        let quote = try XCTUnwrap(parsed.quotes.first)
        XCTAssertEqual(quote.parent, .init(type: "channel", id: "channel"))
        XCTAssertEqual(quote.targetMessageId, "child")
        XCTAssertEqual(quote.targetThreadId, "root")
        XCTAssertEqual(quote.senderId, message.senderID)
        XCTAssertEqual(quote.displayText, "A quoted \"phrase\" with 👩🏽‍💻 & text")
        XCTAssertEqual(parsed.body, "My response")
        XCTAssertTrue(MentionCodec.mentions(in: wire).isEmpty)
        message.threadID = nil
        XCTAssertNil(ReplyTargetContent.wire(for: message), "Replying to the root needs only the enclosing thread ID.")
    }

    func testPreviewAndMarkdownNeverExposeReplyTargetJSON() {
        XCTAssertEqual(MentionCodec.displayText(in: wire + "\n\nMy reply"), "Waiting for the review\n\nMy reply")
        XCTAssertEqual(MentionCodec.markdownForDisplay(in: wire + "\n\nMy reply"), "> Waiting for the review\n\nMy reply")
        XCTAssertEqual(ReplyTargetContent.displayText(in: "<m-reply-target>invalid</m-reply-target>"), "Unknown reply")
    }

    func testCombinedReplyTargetAndMagicChipDoNotLeakInternalTags() {
        let chip = #"<m-magic-chip>{"agentSessionId":"agent-1","promptedMessage":{"turn":0,"author":"user"},"status":"acp_ready"}</m-magic-chip>"#
        let rendered = MentionCodec.displayText(in: wire + "\n\n" + chip)
        XCTAssertEqual(rendered, "Waiting for the review\n\nAgent session")
        XCTAssertFalse(rendered.contains("<m-"))
        XCTAssertFalse(rendered.contains("targetMessageId"))
        XCTAssertTrue(MentionCodec.mentions(in: wire + "\n" + chip).isEmpty)
    }

    func testLegacyChannelAndDocumentReplyTargetsAreAcceptedWithoutMigration() throws {
        let legacy = #"<m-reply-target>{"channelId":"legacy-channel","targetMessageId":"reply","targetThreadId":"root","displayText":"Older reply","senderId":"bot|bot-1"}</m-reply-target>"#
        let old = try XCTUnwrap(ReplyTargetContent.parse(legacy).first)
        XCTAssertEqual(old.parent, .init(type: "channel", id: "legacy-channel"))
        XCTAssertEqual(old.wire, legacy)
        XCTAssertEqual(old.senderName(currentUserID: "me", names: [:]), "Agent")
        let document = wire.replacingOccurrences(of: #""type":"channel""#, with: #""type":"document""#)
        XCTAssertEqual(ReplyTargetContent.parse(document).first?.parent.type, "document")
    }

    func testCodeExamplesStayLiteralAndUnicodeSpansRemoveOnlyTheQuote() {
        let code = "`\(wire)`\n\n```xml\n\(wire)\n```"
        XCTAssertTrue(ReplyTargetContent.parse(code).isEmpty)
        XCTAssertEqual(ReplyTargetContent.displayText(in: code), code)
        let content = "👩🏽‍💻\n" + wire + "\nReply"
        let parsed = ReplyTargetContent.split(content)
        XCTAssertEqual(parsed.quotes.first?.range.location, ("👩🏽‍💻\n" as NSString).length)
        XCTAssertEqual(parsed.body, "👩🏽‍💻\n\nReply")
    }

    func testInvalidParentDoesNotFallBackToLegacyOrProduceATarget() {
        let invalid = #"<m-reply-target>{"parent":{"type":"other","id":"wrong"},"channelId":"legacy","targetMessageId":"reply","targetThreadId":"root","displayText":"Preview","senderId":"user"}</m-reply-target>"#
        XCTAssertTrue(ReplyTargetContent.parse(invalid).isEmpty)
        XCTAssertEqual(ReplyTargetContent.displayText(in: invalid), "Unknown reply")
        let incomplete = String(wire.dropLast(12))
        XCTAssertEqual(ReplyTargetContent.split(incomplete).body, incomplete)
    }
}
