import XCTest
@testable import MacroNative

final class MentionCodecTests: XCTestCase {
    private let user = #"<m-user-mention>{"userId":"macro|jamie@macro.local","email":"jamie@macro.local","displayName":"Jamie Chen"}</m-user-mention>"#
    private let channel = #"<m-document-mention>{"documentId":"channel-1","blockName":"channel","documentName":"Product & design","blockParams":{},"collapsed":false}</m-document-mention>"#

    func testUnnamedBotsUseReadableNamesWithoutChangingReferences() {
        let id = "bot|01900000-0000-7000-8000-000000000003"
        let channel = Channel(id: "room", name: "Room")
        let result = MentionCandidate.search("", channel: channel, channels: [], names: [id: id], currentUserID: "me", includeGroups: false)
        XCTAssertEqual(result.first?.title, "Macro Agent")
        XCTAssertEqual(result.first?.token.entityID, id)
        XCTAssertEqual(result.first?.token.entityType, "bot")
    }

    func testEverySupportedEntityUsesCanonicalMentionWire() {
        let choices = [
            MentionCandidate(kind: .email, id: "email-1", title: "A quoted subject"),
            MentionCandidate(kind: .folder, id: "folder-1", title: "Research"),
            MentionCandidate(kind: .task, id: "task-1", title: "Ship the app"),
            MentionCandidate(kind: .agent, id: "agent-1", title: "Native implementation"),
            MentionCandidate(kind: .chat, id: "chat-1", title: "Planning"),
            MentionCandidate(kind: .company, id: "company-1", title: "Example"),
            MentionCandidate(kind: .call, id: "call-1", title: "Review"),
            MentionCandidate(kind: .calendar, id: "event-1", title: "Standup")
        ]
        XCTAssertEqual(choices.flatMap { MentionCodec.mentions(in: $0.token.wire) }.map(\.entityType),
                       ["thread", "project", "document", "agent_session", "chat", "crm_company", "call", "calendar_event"])
        for choice in choices {
            XCTAssertEqual(MentionCodec.tokens(in: choice.token.wire).first?.token, choice.token)
            XCTAssertEqual(MentionCodec.displayText(in: choice.token.wire), choice.title)
        }
        XCTAssertTrue(choices[3].token.wire.hasPrefix("<m-agent-session-mention>"))
    }

    func testLinkXMLAndDatesDisplayWithoutCreatingNotificationReferences() {
        let link = #"<m-link>{"url":"https://example.com?a=1&b=2","text":"设计 [brief] 👋","title":"Detail"}</m-link>"#
        let date = #"<m-date-mention>{"date":"2026-09-28T00:00:00Z","displayFormat":"Tomorrow"}</m-date-mention>"#
        let content = "See \(link) on \(date)."
        XCTAssertEqual(MentionCodec.displayText(in: content), "See 设计 [brief] 👋 on Tomorrow.")
        XCTAssertTrue(MentionCodec.mentions(in: content).isEmpty)
        XCTAssertEqual(MentionCodec.tokens(in: content).first?.token.wire, link)
        XCTAssertTrue(MentionCodec.markdownForDisplay(in: content).contains("https://example.com?a=1&b=2"))
        XCTAssertEqual(MentionCodec.displayText(in: "`" + link + "`"), "`" + link + "`")
        XCTAssertEqual(MentionCodec.displayText(in: "<m-link>broken</m-link>"), "Unknown link")
        XCTAssertEqual(MentionCodec.markdownForDisplay(in: #"<m-link>{"url":"javascript:alert(1)","text":"A link"}</m-link>"#), "A link")
    }

    func testMobileRankingPinsTwoPeopleThenBlendsOtherEntityKinds() {
        let recent = MessageDate.string()
        let choices = [MentionCandidate(kind: .document, id: "doc", title: "Roadmap", updatedAt: recent),
                       MentionCandidate(kind: .user, id: "one", title: "First"), MentionCandidate(kind: .user, id: "two", title: "Second"),
                       MentionCandidate(kind: .user, id: "three", title: "Third"), MentionCandidate(kind: .email, id: "email", title: "Roadmap review", updatedAt: recent)]
        let ranked = MentionCandidate.ranked(choices, query: "")
        XCTAssertEqual(ranked.prefix(2).map(\.kind), [.user, .user])
        XCTAssertEqual(Set(ranked.dropFirst(2).prefix(2).map(\.kind)), Set([.document, .email]))
        XCTAssertEqual(MentionCandidate.ranked(choices, query: "rmp").first?.id, "doc")
    }

    func testLinkRenderingDoesNotLeakXMLOrInterpretUnsafeLinks() throws {
        let link = MentionCandidate(kind: .link, id: "https://example.com/brief_(final)?q=design", title: "Read [the *brief*] 👩🏽‍💻")
        let wire = "Before \(link.token.wire) after"
        let markdown = MentionCodec.markdownForDisplay(in: wire)
        XCTAssertFalse(markdown.contains("<m-link>"))
        let parsed = try AttributedString(markdown: markdown)
        XCTAssertEqual(String(parsed.characters), "Before Read [the *brief*] 👩🏽‍💻 after")
        XCTAssertEqual(parsed.runs.compactMap(\.link).first?.absoluteString, "https://example.com/brief_%28final%29?q=design")
        let unsafe = MentionCandidate(kind: .link, id: "javascript:alert(1)", title: "Open")
        XCTAssertEqual(MentionCodec.markdownForDisplay(in: unsafe.token.wire), "Open")
        // Incomplete source must survive draft round-trips; it is not a valid authored reference.
        let incomplete = #"<m-link>{"url":"https://example.com","text":"unfinished"#
        XCTAssertTrue(MentionCodec.tokens(in: incomplete).isEmpty)
        XCTAssertTrue(MentionCodec.mentions(in: incomplete).isEmpty)
        XCTAssertEqual(MentionCodec.displayText(in: incomplete), incomplete)
    }

    func testActualWebSyntaxProducesPrettyTextAndAuthoredReferences() {
        let content = "Hi 👋🏽 \(user), let’s talk in \(channel). \(user)"
        XCTAssertEqual(MentionCodec.displayText(in: content), "Hi 👋🏽 @Jamie Chen, let’s talk in #Product & design. @Jamie Chen")
        let references = MentionCodec.mentions(in: content)
        XCTAssertEqual(references.map(\.entityType), ["user", "channel"])
        XCTAssertEqual(references.map(\.entityID), ["macro|jamie@macro.local", "channel-1"])
        let spans = MentionCodec.tokens(in: content)
        XCTAssertEqual(spans.first?.range.location, ("Hi 👋🏽 " as NSString).length)
        XCTAssertEqual(spans.first?.token.wire, user)
    }

    func testCodeExamplesNeverNotifyRecipients() {
        let literal = "`\(user)`\n\n```markdown\n\(channel)\n```\n\n~~~\n\(user)\n~~~\n"
        XCTAssertTrue(MentionCodec.mentions(in: literal).isEmpty)
        XCTAssertEqual(MentionCodec.displayText(in: literal), literal)
        XCTAssertEqual(MentionCodec.mentions(in: literal + user).map(\.entityID), ["macro|jamie@macro.local"])
        XCTAssertTrue(MentionCodec.mentions(in: "```\n" + user).isEmpty)
    }

    func testBotAndHereMatchTheWebNotificationVocabulary() {
        let content = #"<m-user-mention>{"userId":"bot|test","email":"Macro"}</m-user-mention> <m-group-mention>{"groupAlias":"here"}</m-group-mention> <m-group-mention>{"groupAlias":"everyone"}</m-group-mention>"#
        XCTAssertEqual(MentionCodec.mentions(in: content).map(\.entityType), ["bot", "group"])
        XCTAssertEqual(MentionCodec.mentions(in: content).map(\.entityID), ["bot|test", "here"])
    }

    func testLabelsCannotBreakOutOfTheirSerializedToken() {
        let candidate = MentionCandidate(kind: .user, id: "macro|jamie@macro.local", title: "Jamie </m-user-mention> `special` 👩🏽‍💻", subtitle: "jamie@macro.local")
        let parsed = MentionCodec.tokens(in: candidate.token.wire)
        XCTAssertEqual(parsed.count, 1)
        XCTAssertEqual(parsed.first?.token.title, candidate.title)
        XCTAssertEqual(MentionCodec.mentions(in: candidate.token.wire).map(\.entityID), [candidate.id])
    }

    func testCachedParticipantsRankBeforeOtherKnownPeople() {
        let local = Channel(id: "current", participants: [.init(userID: "macro|zara@example.com")])
        let other = Channel(id: "other", name: "Announcements", participants: [.init(userID: "macro|alex@example.com")])
        let names = ["macro|zara@example.com": "Zara", "macro|alex@example.com": "Alex"]
        let candidates = MentionCandidate.search("", channel: local, channels: [local, other], names: names, currentUserID: "macro|me@example.com")
        XCTAssertEqual(candidates.first?.id, "macro|zara@example.com")
        XCTAssertEqual(MentionCandidate.search("ann", channel: local, channels: [other], names: names, currentUserID: "macro|me@example.com").first?.kind, .channel)
        XCTAssertTrue(MentionCandidate.search("missing", channel: local, channels: [other], names: names, currentUserID: "macro|me@example.com").isEmpty)
    }
}
