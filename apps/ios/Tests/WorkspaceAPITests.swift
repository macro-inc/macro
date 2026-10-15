import XCTest
@testable import MacroNative

@MainActor
final class WorkspaceAPITests: XCTestCase {
    private let origin = URL(string: "https://gateway.example.invalid")!
    private let user = "macro|owner@example.com"

    func testAttachmentMetadataBatchKeepsEntityScopeAndOmitsInaccessibleItems() async throws {
        var calls = 0
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            calls += 1
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["limit"].number, 100)
            XCTAssertEqual(body["pf"]["l"]["pids"].string, "folder")
            XCTAssertEqual(body["df"]["|"].array.count, 2)
            XCTAssertEqual(body["chanf"]["l"]["ChannelId"].string, "00000000-0000-0000-0000-000000000000")
            return Data(#"{"items":[{"tag":"project","data":{"id":"folder","name":"Launch"}},{"tag":"document","data":{"id":"file","name":"Design","fileType":"pdf"}}],"next_cursor":null}"#.utf8)
        }
        let document = WorkspaceItem(id: "file", kind: .document, title: "Attachment")
        let result = try await service.items([document, document, .init(id: "unavailable", kind: .document, title: "Attachment"),
            .init(id: "folder", kind: .folder, title: "Attachment", entityType: "project"),
            .init(id: "static", kind: .other, title: "Image", entityType: "static/image")])
        XCTAssertEqual(calls, 1); XCTAssertEqual(result.map(\.id), ["file", "folder"])
        XCTAssertEqual(result[0].fileType, "pdf")
    }

    func testChannelCallsScopeBeforePaginationWithCanonicalAST() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            XCTAssertEqual(request.url?.path, "/dss/items/soup/ast")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["callf"]["l"]["ChannelId"].string, "channel")
            XCTAssertEqual(body["df"]["l"]["id"].string, "00000000-0000-0000-0000-000000000000")
            XCTAssertEqual(body["limit"].number, 100); XCTAssertEqual(body["sort_method"].string, "updated_at")
            XCTAssertEqual(body["sort_direction"].string, "desc"); XCTAssertEqual(body["expand"].bool, true)
            let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first { $0.name == "cursor" }?.value, "page+next=")
            return Data(#"{"items":[{"tag":"call","data":{"callId":"recording","channelId":"channel","customName":"Design review","startedAt":"2026-09-27T12:00:00Z"}}],"next_cursor":null}"#.utf8)
        }
        let page = try await service.channelCalls(channelID: "channel", cursor: "page+next=")
        XCTAssertEqual(page.items.map(\.id), ["recording"]); XCTAssertEqual(page.items[0].channelID, "channel")
    }

    func testHomeThreadResolvesDrivingReplyUsingReadOnlyItemEndpoint() async throws {
        var calls = 0
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            calls += 1
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/notification/user_notifications/item/root")
            let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first { $0.name == "states" }?.value, "unseen,seen")
            return Data(#"{"items":[{"id":"notification","entity_id":"channel","entity_type":"channel","notification_event_type":"channel_message_reply","sender_id":"macro|teammate@example.com","created_at":"2026-09-27T12:00:00Z","state":"seen","notification_metadata":{"tag":"channel_message_reply","content":{"messageId":"reply","threadId":"root"}}}],"next_cursor":null}"#.utf8)
        }
        let original = WorkspaceItem(id: "root", kind: .channel, title: "Thread", channelID: "channel", entityType: "channel_message")
        let resolved = try await service.channelTargetedItem(original)
        XCTAssertEqual(NativeChannelRoute.target(for: resolved), .init(messageID: "reply", threadID: "root"))
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(original.payload, .object([:]), "Routing must not rewrite the underlying feed row or message content.")
    }

    func testExactSearchTargetAndReadChannelNeedNoNotificationRequest() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { _ in XCTFail("Explicit/read routes must remain immediate"); return Data() }
        let search = WorkspaceItem(id: "hit", kind: .channel, title: "Match", channelID: "channel", entityType: "channel_message",
            payload: .object(["message_id": .string("hit"), "thread_id": .string("root")]))
        let resolvedSearch = try await service.channelTargetedItem(search)
        XCTAssertEqual(resolvedSearch, search)
        let channel = WorkspaceItem(id: "channel", kind: .channel, title: "Read", entityType: "channel")
        let resolvedChannel = try await service.channelTargetedItem(channel)
        XCTAssertEqual(resolvedChannel, channel)
    }

    func testChannelNotificationResolutionRejectsRepeatingCursor() async throws {
        var calls = 0
        let service = WorkspaceService(baseURL: origin, userID: user) { _ in
            calls += 1; return Data(#"{"items":[],"next_cursor":"repeat"}"#.utf8)
        }
        do {
            _ = try await service.channelTargetedItem(.init(id: "channel", kind: .channel, title: "Unread", isUnread: true, entityType: "channel"))
            XCTFail("Malformed pagination must not leave Inbox navigation waiting forever")
        } catch { XCTAssertTrue(error is WorkspaceError) }
        XCTAssertEqual(calls, 2)
    }

    func testDemoSignalIncludesSeenItemsAndInboxDoneDoesNotDeleteFiles() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user, isDemo: true) { _ in
            XCTFail("Demo must never request the network"); return Data()
        }
        let initial = try await service.list(.signal)
        let document = try XCTUnwrap(initial.items.first { $0.kind == .document })
        try await service.markSeen(item: document)
        let seen = try await service.list(.signal)
        XCTAssertEqual(seen.items.map(\.id), initial.items.map(\.id))
        XCTAssertFalse(try XCTUnwrap(seen.items.first { $0.id == document.id }).isUnread)
        try await service.setDone(item: document)
        let done = try await service.list(.signal)
        let files = try await service.list(.allFiles)
        XCTAssertFalse(done.items.contains { $0.id == document.id })
        XCTAssertTrue(files.items.contains { $0.id == document.id })
        try await service.setDone(item: document, done: false)
        let restored = try await service.list(.signal)
        XCTAssertTrue(restored.items.contains { $0.id == document.id })
    }

    func testSoupPreservesRealTaskSubtypePropertiesAndNotificationOrdering() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            XCTAssertEqual(request.url?.path, "/dss/items/soup/ast")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["sort_method"].string, "notified_at")
            return Data(#"{"items":[{"tag":"document","data":{"id":"task-1","name":"Ship native","ownerId":"macro|owner@example.com","fileType":"md","subType":{"type":"task","is_completed":false},"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","properties":[{"id":"assignment","definition":{"id":"00000001-0000-0000-0000-000000000002","display_name":"Status"},"value":{"type":"SelectOption","value":["00000001-0000-0000-0002-000000000002"]}}]},"notified_at":"2026-01-04T00:00:00Z","is_favorited":true,"frecency_score":1}],"next_cursor":"opaque+/=="}"#.utf8)
        }
        let page = try await service.list(.signal)
        let task = try XCTUnwrap(page.items.first)
        XCTAssertEqual(task.kind, .task)
        XCTAssertEqual(task.status, "In progress")
        XCTAssertEqual(task.updatedAt, "2026-01-04T00:00:00Z")
        XCTAssertTrue(task.isFavorite)
        XCTAssertTrue(task.isUnread)
        XCTAssertEqual(page.nextCursor, "opaque+/==")
    }

    func testSoupMixedPageAcceptsActualNestedChannelMetadata() async throws {
        // Mirrors SoupItem::Channel serialization in models_soup/src/comms/test.rs:
        // the outer latest-message/viewed fields accompany a nested channel row.
        let service = WorkspaceService(baseURL: origin, userID: user) { _ in
            Data(#"{"items":[{"tag":"document","data":{"id":"file","name":"Plan","fileType":"md","updatedAt":"2026-09-27T12:00:00Z"}},{"tag":"channel","data":{"channel":{"id":"channel","name":"Product","channel_type":"private","owner_id":"macro|owner@example.com","created_at":"2026-09-01T10:00:00Z","updated_at":"2026-09-27T12:01:00Z"},"participants":[{"user_id":"macro|owner@example.com"}],"is_participant":true,"latest_message":{"message_id":"message","content":"Ready to ship","created_at":"2026-09-27T12:01:00Z","sender_id":"macro|owner@example.com"},"viewed_at":"2026-09-26T12:00:00Z"},"touched_at":"2026-09-27T12:02:00Z","is_favorited":true}],"next_cursor":"next-page"}"#.utf8)
        }
        let page = try await service.list(.signal)
        XCTAssertEqual(page.items.map(\.id), ["file", "channel"])
        XCTAssertEqual(page.items[1].kind, .channel)
        XCTAssertEqual(page.items[1].title, "Product")
        XCTAssertEqual(page.items[1].subtitle, "Ready to ship")
        XCTAssertEqual(page.items[1].ownerID, user)
        XCTAssertEqual(page.items[1].updatedAt, "2026-09-27T12:02:00Z")
        XCTAssertTrue(page.items[1].isFavorite)
        XCTAssertEqual(page.nextCursor, "next-page")
    }

    func testDriveRecentSkipsNonFilePagesAndPreservesTouchedOrderAndCursor() async throws {
        var cursors: [String?] = []
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            let cursor = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "cursor" }?.value
            cursors.append(cursor)
            if cursor == nil {
                return Data(#"{"items":[{"tag":"channel","data":{"channel":{"id":"channel","name":"Engineers"}}},{"tag":"emailThread","data":{"id":"email","subject":"Not a file"}}],"next_cursor":"file-page"}"#.utf8)
            }
            return Data(#"{"items":[{"tag":"document","data":{"id":"second-edited","name":"Recent PDF","fileType":"pdf"},"touched_at":"2026-09-27T12:02:00Z"},{"tag":"document","data":{"id":"task","name":"Task","subType":{"type":"task"}}},{"tag":"document","data":{"id":"snippet","name":"Snippet","subType":{"type":"snippet"}}},{"tag":"document","data":{"id":"first-edited","name":"Sheet","fileType":"xlsx"},"touched_at":"2026-09-27T12:01:00Z"},{"tag":"project","data":{"id":"folder","name":"Folder"}}],"next_cursor":"more-files"}"#.utf8)
        }
        let page = try await service.list(.recent)
        XCTAssertEqual(cursors, [nil, "file-page"])
        XCTAssertEqual(page.items.map(\.id), ["second-edited", "first-edited"])
        XCTAssertEqual(page.nextCursor, "more-files")
        XCTAssertTrue(page.items.allSatisfy { $0.kind == .document })
    }

    func testDriveRecentRejectsRepeatedCursorInsteadOfLoopingOnNonFiles() async throws {
        var requests = 0
        let service = WorkspaceService(baseURL: origin, userID: user) { _ in
            requests += 1
            return Data(#"{"items":[],"next_cursor":"repeat"}"#.utf8)
        }
        do { _ = try await service.list(.recent); XCTFail("Repeated cursors must stop") }
        catch { XCTAssertTrue(error is WorkspaceError) }
        XCTAssertEqual(requests, 2)
    }

    func testDriveRecentDemoContainsFilesOnly() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user, isDemo: true) { _ in XCTFail("No network in demo"); return Data() }
        let page = try await service.list(.recent)
        XCTAssertFalse(page.items.isEmpty)
        XCTAssertTrue(page.items.allSatisfy { $0.kind == .document })
    }

    func testViewsFilterAtServerBeforePaginationAndSharedUsesNegatedOwner() throws {
        let shared = WorkspaceService.filters(.sharedFiles, userID: user)
        let text = String(decoding: try JSONEncoder().encode(shared), as: UTF8.self)
        XCTAssertTrue(text.contains("\"!\":{\"l\":{\"o\":\"macro|owner@example.com\"}}"))
        XCTAssertEqual(shared["limit"].number, 50)
        let signal = WorkspaceService.filters(.signal, userID: user)
        let noise = WorkspaceService.filters(.noise, userID: user)
        XCTAssertEqual(signal["sort_method"].string, "notified_at")
        XCTAssertEqual(noise["sort_method"].string, "notified_at")
        XCTAssertEqual(signal["asf"]["l"].string, "inc")
        XCTAssertEqual(noise["df"]["l"]["id"].string, "00000000-0000-0000-0000-000000000000")
        let recent = WorkspaceService.filters(.recent, userID: user)
        XCTAssertEqual(recent["sort_method"].string, "touched_by_me")
        XCTAssertEqual(recent["chanf"], .null, "Touched-by-me rejects channel and email filter trees.")
        XCTAssertEqual(recent["ef"], .null)
        XCTAssertEqual(recent["cf"]["l"]["cid"].string, "00000000-0000-0000-0000-000000000000")
        XCTAssertEqual(recent["pf"]["l"]["pid"].string, "00000000-0000-0000-0000-000000000000")
        let recentText = String(decoding: try JSONEncoder().encode(recent["df"]), as: UTF8.self)
        XCTAssertTrue(recentText.contains("task")); XCTAssertTrue(recentText.contains("snippet")); XCTAssertTrue(recentText.contains("iea"))
    }

    func testFolderScopeAndCursorAreEncodedOnTheirActualWireLocations() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "cursor" })?.value, "opaque+/==")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["df"]["l"]["pid"].string, "folder-id")
            XCTAssertEqual(body["pf"]["l"]["pid"].string, "folder-id")
            XCTAssertEqual(body["expand"].bool, false)
            return Data(#"{"items":[],"next_cursor":null}"#.utf8)
        }
        _ = try await service.folder("folder-id", cursor: "opaque+/==")
    }

    func testSearchDecodesHighlightsAndKeepsDifferentChannelMessageIDs() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            XCTAssertEqual(request.url?.path, "/dss/search")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["match_type"].string, "partial")
            XCTAssertEqual(body["search_on"].string, "name_content")
            return Data(#"{"results":[{"type":"channelMessage","id":"channel","channel_id":"channel","message_id":"message-a","sender_id":"sender","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","highlight":{"content":["Launch <em>native</em> today"]}},{"type":"channelMessage","id":"channel","channel_id":"channel","message_id":"message-b","sender_id":"sender","created_at":"2026-01-02T00:00:00Z","updated_at":"2026-01-02T00:00:00Z","highlight":{"content":["Another native reply"]}}],"next_cursor":"next"}"#.utf8)
        }
        let page = try await service.search("native")
        XCTAssertEqual(page.items.map(\.id), ["message-a", "message-b"])
        XCTAssertEqual(page.items.first?.channelID, "channel")
        XCTAssertEqual(page.items.first?.subtitle, "Launch native today")
        XCTAssertEqual(page.items.first?.kind, .channel)
    }

    func testEmailInboxDoneAndTaskCompletionUseDifferentCanonicalMutations() async throws {
        var requests: [URLRequest] = []
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            requests.append(request)
            return Data(#"{"data":{"setEmailThreadArchived":{"id":"mail","inboxVisible":false}}}"#.utf8)
        }
        let email = WorkspaceItem(id: "mail", kind: .email, title: "Hello", entityType: "email_thread")
        try await service.setDone(item: email)
        let first = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(requests.first?.httpBody))
        XCTAssertEqual(requests.first?.url?.path, "/dss/items/soup/graphql")
        XCTAssertEqual(first["variables"]["input"]["archived"].bool, true)
        XCTAssertEqual(first["variables"]["input"]["threadId"].string, "mail")

        try await service.setTaskCompleted(item: WorkspaceItem(id: "task", kind: .task, title: "Finish"), completed: true)
        let last = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(requests.last?.httpBody))
        XCTAssertEqual(requests.last?.httpMethod, "PUT")
        XCTAssertEqual(requests.last?.url?.path, "/dss/properties/entities/document/task/\(WorkspaceProperty.statusID)")
        XCTAssertEqual(last["value"]["type"].string, "select_option")
        XCTAssertEqual(last["value"]["option_id"].string, WorkspaceProperty.completedID)
    }

    func testCreateTaskUsesBackendOwnedMarkdownInitialization() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            XCTAssertEqual(request.url?.path, "/dss/documents/create_task")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["taskName"].string, "Launch")
            XCTAssertEqual(body["markdown"].string, "Check the release")
            XCTAssertEqual(body["propertyValues"].array.first?["value"]["type"].string, "select_option")
            return Data(#"{"documentId":"created","documentMetadata":{"documentId":"created","documentName":"Launch","owner":"macro|owner@example.com","fileType":"md","subType":{"type":"task","is_completed":false}},"token":"fixture","initialSnapshot":"fixture"}"#.utf8)
        }
        let task = try await service.createDocument(name: " Launch ", markdown: "Check the release", isTask: true)
        XCTAssertEqual(task.id, "created")
        XCTAssertEqual(task.kind, .task)
        XCTAssertEqual(task.title, "Launch")
    }

    func testDemoActionsNeverReachRequestTransport() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user, isDemo: true) { _ in
            XCTFail("Demo mode must not access the network."); throw WorkspaceError.invalidResponse
        }
        for collection in WorkspaceCollection.allCases { _ = try await service.list(collection) }
        _ = try await service.folder("workspace-folder")
        _ = try await service.search("launch")
        _ = try await service.notifications()
        _ = try await service.activeCalls()
        _ = try await service.callRecord("workspace-call")
        let task = try await service.createDocument(name: "Demo task", isTask: true)
        try await service.setTaskCompleted(item: task, completed: true)
        try await service.setFavorite(item: task, favorite: true)
        try await service.rename(item: task, name: "Updated demo task")
        try await service.markSeen(item: task)
        try await service.setDone(item: task)
        _ = try await service.createFolder(name: "Demo folder")
    }

    func testUnreadFilesUsesServerStateWithoutFetchingNotificationDirectory() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            XCTAssertEqual(request.url?.path, "/dss/items/soup/ast")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertTrue(Self.containsLiteral(body["df"], field: "ns", value: .string("unseen")))
            XCTAssertTrue(Self.containsLiteral(body["df"], field: "o", value: .string(self.user)))
            XCTAssertEqual(body["asf"]["l"]["id"].string, "00000000-0000-0000-0000-000000000000")
            return Data(#"{"items":[],"next_cursor":null}"#.utf8)
        }
        _ = try await service.list(.myFiles, filter: WorkspaceListFilter(unreadOnly: true, kind: .document))
    }

    func testFavoriteFilterIntersectsServerIDsBeforePaginationAndCursorRetainsFilter() async throws {
        var paths: [String] = []
        let documentID = "a0000000-0000-4000-8000-000000000001"
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            paths.append(try XCTUnwrap(request.url?.path))
            if request.url?.path == "/dss/favorites" {
                return Data("{\"favorites\":[{\"entityType\":\"document\",\"entityId\":\"\(documentID)\"}]}".utf8)
            }
            XCTAssertEqual(request.url?.path, "/dss/items/soup/ast")
            let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
            if query?.contains(where: { $0.name == "cursor" }) != true {
                let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
                XCTAssertTrue(Self.containsLiteral(body["df"], field: "id", value: .string(documentID)))
                XCTAssertTrue(Self.containsLiteral(body["df"]["&"].array[0], field: "o", value: .string(self.user)))
                XCTAssertTrue(Self.containsLiteral(body["asf"], field: "id", value: .string("00000000-0000-0000-0000-000000000000")))
            }
            return Data(#"{"items":[],"next_cursor":"opaque+/=="}"#.utf8)
        }
        let filter = WorkspaceListFilter(favoritesOnly: true)
        let first = try await service.list(.sharedFiles, filter: filter)
        _ = try await service.list(.sharedFiles, cursor: first.nextCursor, filter: filter)
        XCTAssertEqual(paths, ["/dss/favorites", "/dss/items/soup/ast", "/dss/items/soup/ast"])
    }

    func testUnreadCallsResolveEveryNotificationPageThenFilterOnServer() async throws {
        var notificationPages = 0
        let callA = "a0000000-0000-4000-8000-000000000001"
        let callB = "a0000000-0000-4000-8000-000000000002"
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            if request.url?.path == "/notification/user_notifications" {
                let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
                XCTAssertEqual(query?.first(where: { $0.name == "states" })?.value, "unseen")
                notificationPages += 1
                let id = notificationPages == 1 ? callA : callB
                let next = notificationPages == 1 ? "\"next-notifications\"" : "null"
                return Data("{\"items\":[{\"id\":\"notification-\(notificationPages)\",\"entity_id\":\"\(id)\",\"entity_type\":\"call\",\"notification_event_type\":\"call_summary\",\"created_at\":\"2026-09-27T12:00:00Z\",\"state\":\"unseen\",\"notification_metadata\":{}}],\"next_cursor\":\(next)}".utf8)
            }
            XCTAssertEqual(notificationPages, 2)
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertTrue(Self.containsLiteral(body["callf"], field: "CallId", value: .string(callA)))
            XCTAssertTrue(Self.containsLiteral(body["callf"], field: "CallId", value: .string(callB)))
            return Data(#"{"items":[],"next_cursor":null}"#.utf8)
        }
        _ = try await service.list(.calls, filter: WorkspaceListFilter(unreadOnly: true))
    }

    func testFolderKindFilterKeepsParentScopeAndUsesSelfIDForFavorites() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            if request.url?.path == "/dss/favorites" {
                return Data(#"{"favorites":[{"entityType":"project","entityId":"child-folder"}]}"#.utf8)
            }
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertTrue(Self.containsLiteral(body["pf"], field: "pid", value: .string("parent-folder")))
            XCTAssertTrue(Self.containsLiteral(body["pf"], field: "pids", value: .string("child-folder")))
            XCTAssertTrue(Self.containsLiteral(body["df"], field: "id", value: .string("00000000-0000-0000-0000-000000000000")))
            return Data(#"{"items":[],"next_cursor":null}"#.utf8)
        }
        _ = try await service.folder("parent-folder", filter: WorkspaceListFilter(favoritesOnly: true, kind: .folder))
    }

    func testTaskStatusUsesWriteContractAndReopeningOverridesStaleSubtype() async throws {
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["value"]["type"].string, "select_option")
            XCTAssertTrue(WorkspaceTaskStatus.allCases.map(\.optionID).contains(try XCTUnwrap(body["value"]["option_id"].string)))
            XCTAssertEqual(body["value"]["value"], .null)
            return Data("{}".utf8)
        }
        let task = WorkspaceItem(id: "task", kind: .task, title: "Reopened", status: "Not started", payload: .object([
            "subType": .object(["is_completed": .bool(true)]), "completedAt": .string("2026-09-26T12:00:00Z")]))
        XCTAssertFalse(task.isCompleted)
        for status in WorkspaceTaskStatus.allCases { try await service.setTaskStatus(item: task, status: status) }
    }

    func testCustomSelectOptionLabelsDecodeBothSoupAndDirectPropertyShapes() throws {
        let raw = try JSONDecoder().decode(WorkspaceJSON.self, from: Data(#"{"property":{"id":"assignment"},"definition":{"id":"custom","displayName":"Team"},"value":{"type":"SelectOption","value":["design","count"]},"options":[{"id":"design","value":{"type":"string","value":"Design"}},{"id":"count","value":{"type":"number","value":2}}]}"#.utf8))
        let property = try XCTUnwrap(WorkspaceProperty(raw))
        XCTAssertEqual(property.name, "Team")
        XCTAssertEqual(property.displayValue, "Design, 2")
    }

    func testScopedSearchExcludesOtherIndicesAndResendsScopeWithCursor() async throws {
        let nilID = "00000000-0000-0000-0000-000000000000"
        let scopes: [(WorkspaceKind, String)] = [(.channel, "channel_filters"), (.email, "email_filters"),
            (.agent, "agent_session_filters"), (.task, "document_filters"), (.folder, "project_filters"),
            (.chat, "chat_filters"), (.call, "call_filters"), (.calendar, "calendar_event_filters")]
        for (kind, selectedKey) in scopes {
            var requests = 0
            let service = WorkspaceService(baseURL: origin, userID: user) { request in
                requests += 1
                let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
                let filters = body["filters"]
                XCTAssertNotEqual(filters[selectedKey], .null)
                if kind != .email { XCTAssertEqual(filters["email_filters"]["email_thread_ids"].array, [.string(nilID)]) }
                if kind != .call { XCTAssertEqual(filters["call_filters"]["channel_ids"].array, [.string(nilID)]) }
                if kind != .task { XCTAssertEqual(filters["document_filters"]["document_ids"].array, [.string(nilID)]) }
                if kind == .task { XCTAssertEqual(filters["document_filters"]["sub_types"].array, [.string("task")]) }
                if kind == .agent { XCTAssertEqual(filters["agent_session_filters"]["include"].bool, true) }
                return Data(#"{"results":[],"next_cursor":null}"#.utf8)
            }
            _ = try await service.search("native", kind: kind)
            _ = try await service.search("native", cursor: "scoped-cursor", kind: kind)
            XCTAssertEqual(requests, 2)
        }
    }

    func testFilesSearchAutomaticallyPassesTaskOnlyPagesWithoutLosingCursor() async throws {
        var requests = 0
        let service = WorkspaceService(baseURL: origin, userID: user) { request in
            requests += 1
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["filters"]["document_filters"], .object([:]))
            if requests == 1 {
                return Data(#"{"results":[{"type":"document","id":"task","name":"Native task","sub_type":{"type":"task","is_completed":false}}],"next_cursor":"after-tasks"}"#.utf8)
            }
            let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "cursor" })?.value, "after-tasks")
            return Data(#"{"results":[{"type":"document","id":"file","name":"Native document","sub_type":null}],"next_cursor":"more-files"}"#.utf8)
        }
        let page = try await service.search("native", kind: .document)
        XCTAssertEqual(page.items.map(\.id), ["file"])
        XCTAssertEqual(page.nextCursor, "more-files")
        XCTAssertEqual(requests, 2)
    }

    private static func containsLiteral(_ tree: WorkspaceJSON, field: String, value: WorkspaceJSON) -> Bool {
        if tree["l"][field] == value { return true }
        for op in ["&", "|"] where tree[op].array.contains(where: { containsLiteral($0, field: field, value: value) }) { return true }
        if case .object = tree["!"] { return containsLiteral(tree["!"], field: field, value: value) }
        return false
    }
}
