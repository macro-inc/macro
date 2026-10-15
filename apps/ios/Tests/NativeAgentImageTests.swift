import XCTest
@testable import MacroNative

final class NativeAgentImageTests: XCTestCase {
    func testMarkdownScreenshotsPreserveSurroundingTextAndCodeExamples() {
        let text = "Before\n![Screenshot](https://example.invalid/screen.png)\nAfter\n`![Code](https://example.invalid/code.png)`"
        let blocks = NativeAgentMarkdownBlock.parse(text)
        XCTAssertEqual(blocks.compactMap(\.image).count, 1)
        XCTAssertEqual(blocks.compactMap(\.image).first?.url?.absoluteString, "https://example.invalid/screen.png")
        XCTAssertTrue(blocks.last!.text.contains("`![Code]"))
        XCTAssertEqual(blocks.first?.text, "Before\n")
    }
    func testACPImageProjectionAndStreamingPreservesNativeImageAlongsideText() throws {
        let image: WorkspaceJSON = .object(["type": .string("image"), "mimeType": .string("image/png"), "data": .string(Data([1, 2, 3]).base64EncodedString())])
        XCTAssertEqual(NativeAgentImage.content(image).first?.data, Data([1, 2, 3]))
        let json = #"{"id":"image-log","sessionId":"session","direction":"to_server","content":{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"image","mimeType":"image/png","data":"AQID"}}}},"createdAt":"2026-09-27T12:00:00Z"}"#
        let entry = try JSONDecoder().decode(NativeAgentLogEntry.self, from: Data(json.utf8))
        var transcript = NativeAgentTranscript(); transcript.ingest(entry)
        XCTAssertEqual(transcript.parts.count, 1); XCTAssertEqual(transcript.parts.first?.images.count, 1)
        XCTAssertEqual(transcript.parts.first?.text, "")
        let after = NativeAgentLogEntry(id: "text-after", createdAt: entry.createdAt, direction: "to_server", content: .object([
            "method": .string("session/update"), "params": .object(["update": .object([
                "sessionUpdate": .string("agent_message_chunk"), "content": .object(["type": .string("text"), "text": .string("After image")])])])]))
        transcript.ingest(after)
        XCTAssertEqual(transcript.parts.count, 2, "Text arriving after a screenshot retains transcript order")
        XCTAssertEqual(transcript.parts.last?.text, "After image")
    }
    func testUnsupportedSchemesAndInvalidBase64NeverBecomeImageRequests() {
        XCTAssertTrue(NativeAgentImage.content(.object(["type": .string("image"), "uri": .string("file:///private/file")])).isEmpty)
        XCTAssertTrue(NativeAgentImage.content(.object(["type": .string("image"), "data": .string("not-base64"), "mimeType": .string("image/png")])).isEmpty)
        XCTAssertTrue(NativeAgentMarkdownBlock.parse("![x](http://example.invalid/image)").allSatisfy { $0.image == nil })
    }
}
