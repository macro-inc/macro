import XCTest
@testable import MacroNative

final class WorkspaceRowTests: XCTestCase {
    private let me = "macro|me@example.com"
    private let jamie = "macro|jamie@example.com"

    func testThreadPreviewShowsQuotedRootThenLatestReplyWithoutMutatingWire() throws {
        let payload: WorkspaceJSON = .object(["sender_id": .string(me), "content": .string("Root message"), "thread": .object(["preview": .array([
            .object(["sender_id": .string(jamie), "content": .string("Latest **reply**"), "created_at": .string("2026-09-27T12:00:00Z")]),
            .object(["sender_id": .string(jamie), "content": .string("Earlier reply"), "created_at": .string("2026-09-27T11:00:00Z")]),
        ])])])
        let item = WorkspaceItem(id: "root", kind: .channel, title: "Engineers", channelID: "channel", entityType: "channel_message", payload: payload)
        let display = item.rowDisplay(currentUserID: me, names: [jamie: "Jamie Chen"])
        XCTAssertEqual(display.quote, "You: Root message")
        XCTAssertEqual(display.preview, "Jamie Chen: Latest reply")
        XCTAssertEqual(item.payload, payload)
    }

    func testUnnamedDirectMessageUsesPeopleAndLatestRootContent() throws {
        let raw = Data(#"{"tag":"channel","data":{"channel":{"id":"dm","name":"","channel_type":"direct_message"},"participants":[{"user_id":"macro|me@example.com"},{"user_id":"macro|jamie@example.com"}],"latest_message":{"content":"A newer threaded reply","sender_id":"macro|me@example.com"},"latest_non_thread_message":{"content":"Ready **to ship**","sender_id":"macro|jamie@example.com"}}}"#.utf8)
        let item = try WorkspaceItem.soup(JSONDecoder().decode(WorkspaceJSON.self, from: raw))
        let display = item.rowDisplay(currentUserID: me, names: [jamie: "Jamie Chen"])
        XCTAssertEqual(display.title, "Jamie Chen")
        XCTAssertEqual(display.avatarName, "Jamie Chen")
        XCTAssertEqual(display.avatarUserID, jamie)
        XCTAssertEqual(display.preview, "Ready to ship")
    }

    func testChannelThreadUsesCurrentChannelNameAndSenderInsteadOfConversation() {
        let payload: WorkspaceJSON = .object(["content": .string("Take a look"), "sender_id": .string(jamie)])
        let item = WorkspaceItem(id: "root", kind: .channel, title: "Conversation", channelID: "channel", entityType: "channel_message", payload: payload)
        let display = item.rowDisplay(currentUserID: me, names: [jamie: "Jamie Chen"], channels: [.init(id: "channel", name: "Product & design")])
        XCTAssertEqual(display.title, "Product & design")
        XCTAssertEqual(display.preview, "Jamie Chen: Take a look")
        XCTAssertEqual(display.icon, "arrow-bend-up-left")
        XCTAssertNil(display.avatarName)
    }

    func testOwnDirectMessageAndAttachmentOnlyPreviewStayReadable() {
        let item = WorkspaceItem(id: "dm", kind: .channel, title: "Conversation", entityType: "channel", payload: .object([
            "channel_type": .string("direct_message"),
            "latest_message": .object(["sender_id": .string(me), "content": .string(""), "attachments": .array([.object([:]), .object([:])])])]))
        let display = item.rowDisplay(currentUserID: me, names: [jamie: "Jamie"], channels: [.init(id: "dm", channelType: "direct_message", participants: [.init(userID: me), .init(userID: jamie)])])
        XCTAssertEqual(display.title, "Jamie")
        XCTAssertEqual(display.preview, "You: sent 2 attachments")
    }

    func testDeletedMessageDoesNotLeakItsOriginalContentInHome() {
        let item = WorkspaceItem(id: "root", kind: .channel, title: "Product", entityType: "channel_message", payload: .object([
            "content": .string("Removed secret"), "deleted_at": .string("2026-09-27T12:00:00Z"), "sender_id": .string(jamie)]))
        XCTAssertEqual(item.rowDisplay(currentUserID: me, names: [jamie: "Jamie"]).preview, "Jamie: Message deleted")
        XCTAssertFalse(item.rowDisplay().preview.contains("Removed secret"))
    }

    func testEmailUsesSenderSubjectAndReadableSnippet() {
        let wire = #"Please read <m-link>{"url":"https://macro.com/app","text":"the plan"}</m-link>"#
        let item = WorkspaceItem(id: "email", kind: .email, title: "Launch review", subtitle: wire,
                                 payload: .object(["senderName": .string("Jamie Chen"), "senderEmail": .string("jamie@example.com")]))
        let display = item.rowDisplay()
        XCTAssertEqual(display.title, "Jamie Chen")
        XCTAssertEqual(display.subject, "Launch review")
        XCTAssertEqual(display.preview, "Please read the plan")
        XCTAssertEqual(display.icon, "envelope")
    }

    func testPreviewDecodesMentionsBeforeFlatteningMarkdownAndAgentStatusIsHuman() {
        let person = MentionCandidate(kind: .user, id: jamie, title: "Jamie Chen").token.wire
        XCTAssertEqual(WorkspaceItem.previewText("**Hello** \(person)\n[read more](https://macro.com)"), "Hello @Jamie Chen read more")
        let agent = WorkspaceItem(id: "agent", kind: .agent, title: "Research", status: "acp_ready", payload: .object(["turnState": .string("running")]))
        XCTAssertEqual(agent.rowDisplay().status, "Working")
    }
    func testMentionPreviewFragmentsPreserveEntityTokensAndQuotedReplyStyles() {
        let person = MentionCandidate(kind: .user, id: jamie, title: "Jamie 👩🏽‍💻 Chen").token.wire
        let file = MentionCandidate(kind: .document, id: "plan", title: "**Literal plan**").token.wire
        let root = "**Hello** " + person + "\nPlease review"
        let reply = "Read " + file
        let payload: WorkspaceJSON = .object(["sender_id": .string(me), "content": .string(root), "thread": .object(["preview": .array([
            .object(["sender_id": .string(jamie), "content": .string(reply), "created_at": .string("2026-09-27T12:00:00Z")])
        ])])])
        let item = WorkspaceItem(id: "root", kind: .channel, title: "Engineers", entityType: "channel_message", payload: payload)
        let row = item.rowDisplay(currentUserID: me, names: [jamie: "Jamie"])
        XCTAssertEqual(row.quote, "You: Hello @Jamie 👩🏽‍💻 Chen Please review")
        XCTAssertEqual(row.quoteFragments.filter(\.isMention).map(\.text), ["@Jamie 👩🏽‍💻 Chen"])
        XCTAssertEqual(row.preview, "Jamie: Read **Literal plan**")
        XCTAssertEqual(row.previewFragments.filter(\.isMention).map(\.text), ["**Literal plan**"])
        XCTAssertEqual(item.payload, payload)
    }

    func testLiteralCodeMentionsAndDeletedRepliesNeverBecomePreviewChips() {
        let person = MentionCandidate(kind: .user, id: jamie, title: "Jamie").token.wire
        let fragments = WorkspacePreviewText.fragments("Literal @Jamie and `" + person + "`")
        XCTAssertFalse(fragments.contains(where: \.isMention))
        let payload: WorkspaceJSON = .object(["content": .string("Root"), "thread": .object(["preview": .array([
            .object(["sender_id": .string(jamie), "content": .string(person), "deleted_at": .string("2026-09-27T12:00:00Z")])
        ])])])
        let row = WorkspaceItem(id: "root", kind: .channel, title: "Engineers", entityType: "channel_message", payload: payload).rowDisplay(names: [jamie: "Jamie"])
        XCTAssertEqual(row.preview, "Jamie: Message deleted")
        XCTAssertFalse(row.previewFragments.contains(where: \.isMention))
    }

}
