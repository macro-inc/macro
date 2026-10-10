import XCTest
import UIKit
@testable import MacroNative

@MainActor
final class ChannelAttachmentTests: XCTestCase {
    func testLocalDocumentCopyHashAndCreatePayloadMatchStorageContract() throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("Plan-\(UUID().uuidString).pdf")
        try Data("hello".utf8).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }
        let file = try ChannelUploadFile.importFile(source)
        defer { file.remove() }
        XCTAssertNotEqual(file.url, source)
        XCTAssertEqual(file.entityType, "document")
        XCTAssertEqual(file.sha, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
        let request = try ChannelAttachmentUploader.documentRequest(file, gateway: URL(string: "https://example.invalid")!)
        XCTAssertEqual(request.url?.path, "/dss/documents")
        XCTAssertEqual(request.httpMethod, "POST")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: String])
        XCTAssertEqual(body["documentName"], source.lastPathComponent)
        XCTAssertEqual(body["sha"], file.sha)
        let upload = try ChannelAttachmentUploader.uploadRequest(file, url: "https://storage.example.invalid/signed", contentType: "application/pdf")
        XCTAssertEqual(upload.value(forHTTPHeaderField: "x-amz-checksum-sha256"), file.checksum)
        XCTAssertNil(upload.value(forHTTPHeaderField: "Authorization"))
    }

    func testPhotoUsesStaticMediaServiceAndImageEntityType() throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 16, height: 8)).image { context in
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 16, height: 8))
        }
        let file = try ChannelUploadFile.photo(XCTUnwrap(image.pngData()))
        defer { file.remove() }
        XCTAssertEqual(file.entityType, "static/image")
        XCTAssertEqual(file.contentType, "image/jpeg")
        XCTAssertNotNil(file.width)
        XCTAssertNotNil(file.height)
        let request = try ChannelAttachmentUploader.mediaRequest(file, environment: .development)
        XCTAssertEqual(request.url?.host, "static-file-service-dev.macro.com")
        XCTAssertEqual(request.url?.path, "/api/file")
        XCTAssertEqual(request.httpMethod, "PUT")
        let upload = try ChannelAttachmentUploader.uploadRequest(file, url: "https://storage.example.invalid/signed", contentType: file.contentType)
        XCTAssertNil(upload.value(forHTTPHeaderField: "x-amz-checksum-sha256"), "Static uploads use the service MIME contract, unlike DSS checksummed uploads")
        XCTAssertNil(upload.value(forHTTPHeaderField: "Authorization"))
    }

    func testDemoUploadCannotReachRealServices() async throws {
        let file = ChannelUploadFile(url: URL(fileURLWithPath: "/nonexistent-fixture"), name: "Photo.jpg", contentType: "image/jpeg", sha: "fixture", checksum: "fixture", width: 16, height: 8)
        let attachment = try await ChannelAttachmentUploader(session: .demo()).upload(file)
        XCTAssertTrue(attachment.entityID.hasPrefix("demo-upload-"))
        XCTAssertEqual(attachment.entityType, "static/image")
        XCTAssertEqual(attachment.width, 16)
    }

    func testExistingFilePickerIncludesDocumentsAndSearchesWithoutTasks() async {
        let store = ChannelAttachmentPickerStore(service: WorkspaceService(session: .demo()))
        await store.load()
        XCTAssertEqual(Set(store.items.map(\.id)), ["workspace-design", "workspace-shared"])
        XCTAssertTrue(store.items.allSatisfy { $0.kind == .document })
        store.search = "roadmap"
        await store.load()
        XCTAssertEqual(store.items.map(\.id), ["workspace-shared"])
    }
    func testChangingSearchDuringPaginationDoesNotLeavePickerLoadingMore() async {
        let requested = expectation(description: "Older page requested")
        var requestCount = 0
        var pending: CheckedContinuation<Data, Error>?
        let first = Data(#"{"items":[{"tag":"document","data":{"id":"first","name":"First","fileType":"pdf"}}],"next_cursor":"older"}"#.utf8)
        let replacement = Data(#"{"results":[{"type":"document","id":"new","name":"New result","file_type":"pdf"}],"next_cursor":"new-page"}"#.utf8)
        let service = WorkspaceService(baseURL: URL(string: "https://example.invalid")!, userID: "macro|test@example.com") { _ in
            requestCount += 1
            if requestCount == 1 { return first }
            if requestCount == 2 {
                return try await withCheckedThrowingContinuation { continuation in pending = continuation; requested.fulfill() }
            }
            return replacement
        }
        let store = ChannelAttachmentPickerStore(service: service)
        await store.load()
        let older = Task { await store.loadMore() }
        await fulfillment(of: [requested], timeout: 2)
        store.search = "new result"
        await store.load()
        XCTAssertFalse(store.isLoadingMore)
        pending?.resume(returning: first)
        await older.value
        XCTAssertFalse(store.isLoadingMore)
        XCTAssertEqual(store.items.map(\.id), ["new"])
    }

}
