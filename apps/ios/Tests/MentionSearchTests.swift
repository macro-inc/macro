import XCTest
@testable import MacroNative

@MainActor
final class MentionSearchTests: XCTestCase {
    func testWorkspaceResultsCoverEveryMentionableEntity() {
        let mappings: [(WorkspaceKind, String, MentionKind)] = [(.document, "document", .document), (.task, "document", .task), (.folder, "project", .folder), (.email, "email_thread", .email), (.agent, "agent_session", .agent), (.chat, "chat", .chat), (.channel, "channel", .channel), (.call, "call", .call), (.calendar, "calendar_event", .calendar), (.other, "crm_company", .company)]
        for (kind, entity, expected) in mappings {
            let item = WorkspaceItem(id: "id", kind: kind, title: "A name", entityType: entity)
            XCTAssertEqual(MentionSearchService.candidate(item)?.kind, expected)
        }
        let reply = WorkspaceItem(id: "message-1", kind: .channel, title: "Engineering", channelID: "channel-1", entityType: "channel_message")
        XCTAssertEqual(MentionSearchService.candidate(reply)?.id, "channel-1")
        XCTAssertNil(MentionSearchService.candidate(WorkspaceItem(id: "message-1", kind: .channel, title: "No channel", entityType: "channel_message")))
    }
    func testDemoSearchIncludesRecentEmailFilesFoldersTasksAndPeopleWithoutNetwork() async {
        let search = MentionSearchService(session: .demo())
        let initial = await search.search("")
        let kinds = Set(initial.map(\.kind))
        XCTAssertTrue(kinds.contains(.user)); XCTAssertTrue(kinds.contains(.document)); XCTAssertTrue(kinds.contains(.email))
        XCTAssertTrue(kinds.contains(.task)); XCTAssertTrue(kinds.contains(.folder)); XCTAssertTrue(kinds.contains(.date))
        let files = await search.search("mobile")
        XCTAssertTrue(files.contains { $0.kind == .document })
    }
    func testDateSuggestionsUseCanonicalDateTagsAndPreserveTypedDate() {
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        let suggestions = MentionSearchService.dates("Tomorrow", now: date)
        XCTAssertTrue(suggestions.contains { $0.title == "Tomorrow" })
        XCTAssertTrue(suggestions.allSatisfy { $0.token.wire.contains("<m-date-mention>") && MentionCodec.mentions(in: $0.token.wire).isEmpty })
    }

    func testDocumentSubtypeAndFileKindPreserveTheirWebDestination() {
        for subtype in ["snippet", "skill"] {
            let item = WorkspaceItem(id: subtype, kind: .document, title: "Example", fileType: "md", payload: .object(["subType": .object(["type": .string(subtype)])]))
            XCTAssertEqual(MentionSearchService.candidate(item)?.blockName, subtype)
        }
        for (file, block) in [("pdf", "pdf"), ("xlsx", "spreadsheet"), ("png", "image"), ("mp4", "video"), ("swift", "code")] {
            let item = WorkspaceItem(id: file, kind: .document, title: "Example", fileType: file)
            XCTAssertEqual(MentionSearchService.candidate(item)?.blockName, block)
        }
    }

    func testSearchRetainsCachedResultsAndNeverOffersUnknownEntities() async {
        let search = MentionSearchService(session: .demo())
        let first = await search.search("launch")
        let again = await search.search("launch")
        XCTAssertEqual(first.map(\.identity), again.map(\.identity))
        XCTAssertTrue(first.contains { $0.kind == .agent })
        XCTAssertFalse(search.hasMore("launch"))
        let more = await search.loadMore("launch")
        XCTAssertEqual(more.map(\.identity), first.map(\.identity))
        XCTAssertNil(MentionSearchService.candidate(WorkspaceItem(id: "unknown", kind: .other, title: "Unknown", entityType: "unsupported")))
        XCTAssertTrue(MentionCandidate.search("here", channel: .init(id: "agent"), channels: [], names: [:], currentUserID: "me", includeGroups: false).isEmpty)
    }

    func testMentionRecentsUseUnrestrictedTouchedFeedInsteadOfDriveFiles() async throws {
        var requests: [URLRequest] = []
        let workspace = WorkspaceService(baseURL: URL(string: "https://example.invalid")!, userID: "me") { request in
            requests.append(request)
            return Data(#"{"items":[{"tag":"project","data":{"id":"folder","name":"Folder"}},{"tag":"emailThread","data":{"id":"email","name":"Email"}},{"tag":"document","data":{"id":"task","name":"Task","subType":{"type":"task"}}}],"next_cursor":"next"}"#.utf8)
        }
        let page = try await workspace.allEntityRecents(cursor: "prior")
        XCTAssertEqual(Set(page.items.map(\.kind)), [.folder, .email, .task])
        XCTAssertEqual(page.nextCursor, "next")
        let request = try XCTUnwrap(requests.first)
        let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
        XCTAssertEqual(body["sort_method"].string, "touched_by_me")
        for target in ["df", "cf", "pf", "chanf", "ef"] { XCTAssertNil(body.object?[target], "Mentions must keep all touchable kinds") }
        XCTAssertTrue(request.url!.absoluteString.contains("cursor=prior"))
        XCTAssertNotNil(WorkspaceService.filters(.recent, userID: "me").object?["df"], "Drive must retain its document restriction")
    }

    func testShortQueryPaginatesRecentsDeduplicatesAndStopsRepeatedCursor() async {
        var paths: [String] = []
        let workspace = WorkspaceService(baseURL: URL(string: "https://example.invalid")!, userID: "me") { request in
            paths.append(request.url!.absoluteString)
            if paths.count == 1 {
                return Data(#"{"items":[{"tag":"document","data":{"id":"one","name":"Launch plan"}}],"next_cursor":"page-2"}"#.utf8)
            }
            return Data(#"{"items":[{"tag":"document","data":{"id":"one","name":"Launch plan"}},{"tag":"project","data":{"id":"two","name":"Launch folder"}}],"next_cursor":"page-2"}"#.utf8)
        }
        let search = MentionSearchService(session: .demo(), workspace: workspace)
        let first = await search.search("la")
        XCTAssertTrue(first.contains { $0.id == "one" })
        XCTAssertTrue(search.hasMore("la"))
        let second = await search.loadMore("la")
        XCTAssertEqual(second.filter { $0.id == "one" }.count, 1)
        XCTAssertTrue(second.contains { $0.id == "two" })
        XCTAssertFalse(search.hasMore("la"))
        XCTAssertFalse(search.hasMore(""))
        XCTAssertEqual(paths.count, 2)
        XCTAssertTrue(paths.last?.contains("cursor=page-2") == true)
        let recents = await search.search("")
        XCTAssertTrue(recents.contains { $0.id == "two" })
    }

    func testFailedRemoteSearchKeepsLocalRecentsUsable() async {
        var calls = 0
        let workspace = WorkspaceService(baseURL: URL(string: "https://example.invalid")!, userID: "me") { request in
            calls += 1
            if request.url?.path.hasSuffix("soup/ast") == true {
                return Data(#"{"items":[{"tag":"document","data":{"id":"one","name":"Launch plan"}}]}"#.utf8)
            }
            throw URLError(.notConnectedToInternet)
        }
        let search = MentionSearchService(session: .demo(), workspace: workspace)
        let results = await search.search("launch")
        XCTAssertTrue(results.contains { $0.id == "one" })
        XCTAssertEqual(calls, 2)
    }
}
