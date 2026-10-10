import XCTest
@testable import MacroNative

final class EmailRichBodyTests: XCTestCase {
    func testNativeMentionExportsPortableLinkAndNeverLeaksWireIntoPlainText() throws {
        let token = MentionCandidate(kind: .document, id: "document-id", title: "Plan & <notes>", blockName: "md").token
        var draft = EmailComposition(inboxID: "inbox")
        draft.to = "person@example.com"; draft.body = "See " + token.wire + "\n<script>alert(1)</script>"
        draft.webURL = URL(string: "https://dev.macro.com/app")!
        let input = try draft.input(requireRecipients: true)
        XCTAssertEqual(input.body_text, "See Plan & <notes>\n<script>alert(1)</script>")
        XCTAssertFalse(input.body_text.contains("<m-document-mention>"))
        XCTAssertEqual(input.body_macro, draft.body)
        let prepared = EmailRichBody.prepare(draft.body, webURL: draft.webURL)
        XCTAssertTrue(prepared.html.contains("href=\"https://dev.macro.com/app/md/document-id\""))
        XCTAssertTrue(prepared.html.contains("Plan &amp; &lt;notes&gt;"))
        XCTAssertTrue(prepared.html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"))
        XCTAssertTrue(prepared.html.contains("data-document-mention=\"true\""))
        XCTAssertEqual(input.body_html, prepared.encodedHTML)
        XCTAssertFalse(prepared.encodedHTML.contains("="))
    }
    func testMultipleUnicodeMentionsPreserveOffsetsAndPlainLiteralCode() {
        let user = MentionCandidate(kind: .user, id: "macro|jane@example.com", title: "Jane 👩🏽‍💻").token
        let channel = MentionCandidate(kind: .channel, id: "design-id", title: "设计").token
        let value = "👋 " + user.wire + " → " + channel.wire + "\n`<m-link>{\"url\":\"https://example.com\",\"text\":\"literal\"}</m-link>`"
        let rendered = EmailRichBody.prepare(value, webURL: URL(string: "https://macro.com/app")!)
        XCTAssertTrue(rendered.text.hasPrefix("👋 @Jane 👩🏽‍💻 → #设计"))
        XCTAssertTrue(rendered.html.contains("/app/channel/design-id"))
        XCTAssertFalse(rendered.html.contains("href=\"https://example.com\""), "Code content remains literal text")
    }
    func testAgentSessionMentionUsesItsActualWorkspaceRoute() {
        let agent = MentionCandidate(kind: .agent, id: "agent-id", title: "Research").token
        let value = EmailRichBody.prepare(agent.wire, webURL: URL(string: "https://macro.com/app")!)
        XCTAssertEqual(value.text, "Research")
        XCTAssertTrue(value.html.contains("href=\"https://macro.com/app/agents/agent-id\""))
    }
    func testUnsafeLinkSchemeAndPathCannotCreateExecutableHTML() {
        let dangerous = MentionCandidate(kind: .link, id: "javascript:alert(1)", title: "Click <here>").token
        let traversal = MentionCandidate(kind: .document, id: "../secret", title: "File", blockName: "md").token
        let value = EmailRichBody.prepare(dangerous.wire + " " + traversal.wire, webURL: URL(string: "https://macro.com/app")!)
        XCTAssertFalse(value.html.contains("<a "))
        XCTAssertEqual(value.text, "Click <here> File")
    }
}
