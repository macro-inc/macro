import XCTest
@testable import MacroNative

@MainActor
final class ChannelAgentCardTests: XCTestCase {
    private let chip = #"<m-magic-chip>{"agentSessionId":"session","channelId":"channel","promptedMessage":{"turn":0,"author":"user"},"status":"acp_ready"}</m-magic-chip>"#

    func testCanonicalCardKeepsTurnAndRemovesWireFromBody() {
        let content = ChannelAgentCardContent.parse("I’ll take a look.\n\n" + chip)
        XCTAssertEqual(content.body, "I’ll take a look.")
        XCTAssertEqual(content.cards, [.init(sessionID: "session", turn: 0, status: "acp_ready")])
        XCTAssertEqual(MentionCodec.displayText(in: chip), "Agent session")
        XCTAssertEqual(ChannelAgentCardContent.parse(chip + chip).cards.count, 1)
    }
    func testCodeExamplesRemainLiteralAndMalformedDisplaysUnknownWithoutCreatingCard() {
        for literal in ["`" + chip + "`", "```\n" + chip + "\n```"] {
            XCTAssertEqual(ChannelAgentCardContent.parse(literal).body, literal)
            XCTAssertTrue(ChannelAgentCardContent.parse(literal).cards.isEmpty)
        }
        let malformed = "<m-magic-chip>{broken}</m-magic-chip>"
        XCTAssertTrue(ChannelAgentCardContent.parse(malformed).cards.isEmpty)
        XCTAssertEqual(ChannelAgentCardContent.displayText(in: malformed), "Unknown agent session")
        XCTAssertEqual(ChannelAgentCardContent.displayText(in: "`" + malformed + "`"), "`" + malformed + "`")
        let fractional = chip.replacingOccurrences(of: #""turn":0"#, with: #""turn":0.5"#)
        XCTAssertTrue(ChannelAgentCardContent.parse(fractional).cards.isEmpty)
        XCTAssertTrue(ChannelAgentCardContent.parse(chip.replacingOccurrences(of: #""turn":0"#, with: #""turn":9223372036854775808"#)).cards.isEmpty)
    }
    func testAnchoredSummaryDoesNotFollowNewerTurnAndStopPreservesStoppedStatus() {
        var first = NativeAgentFixtures.turn(prompt: "First", answer: "First reply", actionID: "first", date: Date(timeIntervalSince1970: 100))
        first[first.count - 1].content = .object(["type": .string("acp"), "id": .string("first"), "result": .object(["stopReason": .string("cancelled")])])
        let later = NativeAgentFixtures.turn(prompt: "Later", answer: "Later reply", actionID: "later", date: Date(timeIntervalSince1970: 200))
        let cards = ChannelAgentSummary.project(first + later)
        XCTAssertEqual(cards[0]?.text, "First reply")
        XCTAssertEqual(cards[0]?.status, "Stopped")
        XCTAssertEqual(cards[1]?.text, "Later reply")
        XCTAssertEqual(cards[1]?.status, "Done")
        XCTAssertEqual(cards[1]?.finished, true)
    }
    func testControlConsumesTurnIDWithoutStealingActiveReply() {
        let first = NativeAgentFixtures.turn(prompt: "First", answer: "First reply", actionID: "first")
        let control = NativeAgentLogEntry(id: "control", createdAt: "", direction: "to_runtime", content: .object(["type": .string("acp"), "method": .string("session/cancel")]))
        let later = NativeAgentFixtures.turn(prompt: "Later", answer: "Later reply", actionID: "later")
        let cards = ChannelAgentSummary.project(Array(first.prefix(2)) + [control, first[2]] + later)
        XCTAssertEqual(cards[0]?.text, "First reply")
        XCTAssertNil(cards[1])
        XCTAssertEqual(cards[2]?.text, "Later reply")
    }
    func testPullRequestMetadataUsesVerifiedDSSSourceLookup() async throws {
        let api = NativeAgentAPI(baseURL: URL(string: "https://gateway.example.invalid")!) { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/dss/foreign_entity/by_source/github_pull_request/macro-inc/macro/pull/7081")
            return Data(#"{"foreignEntitySource":"github_pull_request","metadata":{"name":"Add search functionality","status":"open","additions":79,"deletions":19}}"#.utf8)
        }
        let pr = try await api.pullRequest(URL(string: "https://github.com/macro-inc/macro/pull/7081")!)
        XCTAssertEqual(pr?.number, "7081")
        XCTAssertEqual(pr?.title, "Add search functionality")
        XCTAssertEqual(pr?.additions, 79)
        XCTAssertEqual(pr?.deletions, 19)
        XCTAssertNil(ChannelAgentPullRequest.githubKey(URL(string: "https://example.com/macro-inc/macro/pull/7081")!))
    }
}
