import XCTest
@testable import MacroNative

@MainActor
final class NativeTaskComposerTests: XCTestCase {
    func testFreshTaskAssignsCurrentUserAndKeepsStatusInCanonicalAPIShape() {
        let draft = NativeTaskComposerDraft.initial(userID: "macro|me", displayName: "Me")
        XCTAssertEqual(draft.assignees.map(\.id), ["macro|me"])
        let status = draft.properties.first { $0["propertyId"].string == WorkspaceProperty.statusID }
        XCTAssertEqual(status?["value"]["type"].string, "select_option")
        XCTAssertEqual(status?["value"]["option_id"].string, WorkspaceTaskStatus.notStarted.optionID)
        let assignees = draft.properties.first { $0["propertyId"].string == WorkspaceProperty.assigneesID }
        XCTAssertEqual(assignees?["value"]["type"].string, "multi_entity_reference")
        XCTAssertEqual(assignees?["value"]["references"].array.first?["entity_id"].string, "macro|me")
    }

    func testTaskPropertiesSubmitTogetherWithoutFollowUpMutations() async throws {
        var draft = NativeTaskComposerDraft.initial(userID: "macro|me", displayName: "Me")
        draft.title = "Parity task"; draft.content = "A useful description"; draft.status = WorkspaceTaskStatus.inProgress.rawValue
        draft.priority = 4; draft.dueDate = Date(timeIntervalSince1970: 1_800_000_000)
        draft.tags = [.init(id: "tag1", definitionID: "personal-tags", name: "Design", scope: "Personal")]
        var requests: [URLRequest] = []
        let service = WorkspaceService(baseURL: URL(string: "https://example.invalid")!, userID: "macro|me") { request in
            requests.append(request)
            return Data(#"{"documentId":"created-task"}"#.utf8)
        }
        let item = try await service.createDocument(name: draft.title, markdown: draft.markdown, isTask: true, taskProperties: draft.properties)
        XCTAssertEqual(item.id, "created-task")
        XCTAssertEqual(item.status, WorkspaceTaskStatus.inProgress.title)
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.url?.path, "/dss/documents/create_task")
        let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(requests.first?.httpBody))
        XCTAssertEqual(body["taskName"].string, draft.title)
        XCTAssertEqual(body["markdown"].string, draft.content)
        XCTAssertEqual(body["propertyValues"].array.count, 5)
        XCTAssertEqual(body["propertyValues"].array.first?["value"]["option_id"].string, WorkspaceTaskStatus.inProgress.optionID)
        XCTAssertEqual(body["propertyValues"].array.last?["value"]["option_ids"].array.first?.string, "tag1")
    }

    func testTaskDraftRestoresPropertiesOnlyForItsOwnAccountAndClears() throws {
        let account = "task-draft-test-" + UUID().uuidString
        defer { NativeTaskDraftCache.clear(account: account) }
        var draft = NativeTaskComposerDraft.initial(userID: "me", displayName: "Me")
        draft.title = "Keep this draft"; draft.priority = 2; draft.dueDate = Date(timeIntervalSince1970: 1_800_000_000)
        NativeTaskDraftCache.write(draft, account: account)
        XCTAssertEqual(NativeTaskDraftCache.read(account: account), draft)
        XCTAssertNil(NativeTaskDraftCache.read(account: account + "-other"))
        NativeTaskDraftCache.clear(account: account)
        XCTAssertNil(NativeTaskDraftCache.read(account: account))
    }
}
