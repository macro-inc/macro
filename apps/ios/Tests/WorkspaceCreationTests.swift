import XCTest
import CryptoKit
@testable import MacroNative

@MainActor
final class WorkspaceCreationTests: XCTestCase {
    private let gateway = URL(string: "https://gateway.example.invalid")!

    func testBlankSnippetUsesSnippetEndpointAndProjectsSnippetSubtype() async throws {
        let service = WorkspaceService(baseURL: URL(string: "https://gateway.example.invalid")!, userID: "user") { request in
            XCTAssertEqual(request.url?.path, "/dss/documents/create_snippet")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["snippetName"].string, ""); XCTAssertEqual(body["markdown"].string, "")
            XCTAssertNil(body["documentName"].string)
            return Data(#"{"documentId":"snippet"}"#.utf8)
        }
        let item = try await service.createBlankResource(.snippet)
        XCTAssertEqual(item.payload["subType"]["type"].string, "snippet")
    }
    func testBlankDocumentUsesEmptyProductionNameAndMarkdown() async throws {
        let api = WorkspaceService(baseURL: gateway, userID: "owner") { request in
            XCTAssertEqual(request.url?.path, "/dss/documents/create_markdown")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["documentName"].string, ""); XCTAssertEqual(body["markdown"].string, "")
            XCTAssertEqual(body["projectId"].string, "folder")
            return Data(#"{"documentId":"new-doc","documentMetadata":{"documentId":"new-doc","documentName":""}}"#.utf8)
        }
        let item = try await api.createBlankResource(.document, projectID: "folder")
        XCTAssertEqual(item.id, "new-doc"); XCTAssertEqual(item.title, "Untitled"); XCTAssertEqual(item.fileType, "md")
    }

    func testCanvasAndCodeUploadExactInitialBytesWithoutAccountCredentials() async throws {
        for resource in [WorkspaceBlankResource.canvas, .code] {
            var uploads = 0
            let api = WorkspaceService(baseURL: gateway, userID: "owner", upload: { request in
                uploads += 1
                XCTAssertEqual(request.url?.host, "new-files.example.invalid"); XCTAssertEqual(request.httpMethod, "PUT")
                XCTAssertEqual(request.httpBody, resource.initialData)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), resource.contentType)
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-amz-checksum-sha256"), Data(SHA256.hash(data: resource.initialData)).base64EncodedString())
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                return Data()
            }) { request in
                XCTAssertEqual(request.url?.path, "/dss/documents")
                let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
                XCTAssertEqual(body["fileType"].string, resource.fileType); XCTAssertEqual(body["documentName"].string, resource.defaultName)
                XCTAssertEqual(body["sha"].string, SHA256.hash(data: resource.initialData).map { String(format: "%02x", $0) }.joined())
                return Data(#"{"data":{"documentMetadata":{"documentId":"created"},"presignedUrl":"https://new-files.example.invalid/upload"}}"#.utf8)
            }
            let item = try await api.createBlankResource(resource)
            XCTAssertEqual(item.id, "created"); XCTAssertEqual(item.fileType, resource.fileType); XCTAssertEqual(uploads, 1)
        }
    }

    func testSpreadsheetInitializesSyncServiceWithoutS3Upload() async throws {
        let api = WorkspaceService(baseURL: gateway, userID: "owner", upload: { _ in XCTFail("Spreadsheet must be initialized on server"); return Data() }) { request in
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["fileType"].string, "spreadsheet")
            XCTAssertEqual(body["documentName"].string, "Untitled spreadsheet")
            XCTAssertEqual(body["sha"].string, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
            return Data(#"{"data":{"documentMetadata":{"documentId":"sheet"},"presignedUrl":null}}"#.utf8)
        }
        let item = try await api.createBlankResource(.spreadsheet)
        XCTAssertEqual(item.id, "sheet"); XCTAssertEqual(item.fileType, "spreadsheet")
    }

    func testFailedUploadRollsBackOnlyNewlyAllocatedFile() async throws {
        var requests: [String] = []
        let api = WorkspaceService(baseURL: gateway, userID: "owner", upload: { _ in throw URLError(.networkConnectionLost) }) { request in
            requests.append((request.httpMethod ?? "") + " " + (request.url?.path ?? ""))
            return request.httpMethod == "DELETE" ? Data() : Data(#"{"data":{"documentMetadata":{"documentId":"new-only"},"presignedUrl":"https://new-files.example.invalid/upload"}}"#.utf8)
        }
        do { _ = try await api.createBlankResource(.canvas); XCTFail("Upload failure must remain visible") } catch { XCTAssertTrue(error is URLError) }
        XCTAssertEqual(requests, ["POST /dss/documents", "DELETE /dss/documents/new-only"])
    }
}
