import XCTest
@testable import MacroNative

@MainActor
final class TaskDetailTests: XCTestCase {
    private let origin = URL(string: "https://gateway.example.invalid")!

    func testNativeTaskEditsPersistThroughRefreshAndReopenLegacyCompletedPayload() async throws {
        let service = WorkspaceService(baseURL: origin, userID: "macro|preview@example.com", isDemo: true) { _ in
            XCTFail("A preview task must never access the network.")
            throw WorkspaceError.invalidResponse
        }
        let page = try await service.list(.tasks)
        var item = try XCTUnwrap(page.items.first)
        item.payload = .object(["subType": .object(["type": .string("task"), "is_completed": .bool(true)])])
        let model = NativeTaskDetailStore(item: item, service: service)
        await model.setStatus(.completed)
        XCTAssertTrue(model.item.isCompleted)
        await model.setStatus(.inReview)
        XCTAssertFalse(model.item.isCompleted)
        await model.rename("  A native task  ")
        await model.refresh()
        XCTAssertEqual(model.item.title, "A native task")
        XCTAssertEqual(model.item.status, "In review")
        XCTAssertNil(model.error)
    }

    func testRejectedMutationsKeepTheLastConfirmedTaskVisible() async throws {
        let service = WorkspaceService(baseURL: origin, userID: "user") { _ in throw MessagingError.http(403) }
        let original = WorkspaceItem(id: "task", kind: .task, title: "Keep this title", status: "In progress")
        let model = NativeTaskDetailStore(item: original, service: service)
        await model.setStatus(.completed)
        XCTAssertEqual(model.item, original)
        XCTAssertNotNil(model.error)
        XCTAssertFalse(model.isSaving)
        await model.rename("New title")
        XCTAssertEqual(model.item, original)
        XCTAssertNotNil(model.error)
        XCTAssertFalse(model.isSaving)
    }

    func testOldRefreshCannotOverwriteAStatusChangedWhileLoading() async throws {
        var delayed: CheckedContinuation<Data, Error>?
        let loading = expectation(description: "Task refresh started")
        let service = WorkspaceService(baseURL: origin, userID: "user") { request in
            if request.httpMethod == "POST" {
                return try await withCheckedThrowingContinuation { continuation in
                    delayed = continuation
                    loading.fulfill()
                }
            }
            return Data()
        }
        let model = NativeTaskDetailStore(item: WorkspaceItem(id: "task", kind: .task, title: "Task", status: "In progress"), service: service)
        let refresh = Task { await model.refresh() }
        await fulfillment(of: [loading], timeout: 1)
        await model.setStatus(.completed)
        delayed?.resume(returning: Data(#"{"items":[{"tag":"document","data":{"id":"task","name":"Task","subType":{"type":"task","is_completed":false},"status":"In progress"}}]}"#.utf8))
        await refresh.value
        XCTAssertEqual(model.item.status, "Completed")
        XCTAssertTrue(model.item.isCompleted)
        XCTAssertFalse(model.isLoading)
    }
}
