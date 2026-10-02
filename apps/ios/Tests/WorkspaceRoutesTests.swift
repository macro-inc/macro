import XCTest
@testable import MacroNative

final class WorkspaceRoutesTests: XCTestCase {
    func testDocumentsOpenTheirRegisteredEditors() {
        for (type, route) in [("md", "md"), ("spreadsheet", "spreadsheet"), ("docx", "pdf"), ("png", "image"), ("rs", "code"), ("csv", "csv"), ("unrecognized", "unknown")] {
            let item = WorkspaceItem(id: "file-id", kind: .document, title: "File", fileType: type)
            XCTAssertEqual(WorkspaceRoutes.path(for: item), "\(route)/file-id")
        }
        XCTAssertEqual(WorkspaceRoutes.path(for: WorkspaceItem(id: "task-id", kind: .task, title: "Task")), "task/task-id")
    }
    func testAgentPrefixBecomesNativeLinkWithoutLeakingMarkup() {
        let content = #"<m-agent-session-mention>{"id":"session-1"}</m-agent-session-mention>"# + "\n\nHello **team**"
        var message = ChatMessage(id: "message", parent: MessageParent(id: "channel"), senderID: "bot|agent", content: content, createdAt: "", updatedAt: "")
        XCTAssertEqual(ChannelAgentLink.parse(message), ChannelAgentLink(id: "session-1", body: "Hello **team**"))
        message.senderID = "macro|person@example.com"
        XCTAssertNil(ChannelAgentLink.parse(message), "A person's quoted mention remains body content.")
        message.senderID = "bot|agent"
        message.content = content.replacingOccurrences(of: "\n\n", with: " continuing on same line ")
        XCTAssertNil(ChannelAgentLink.parse(message), "Only the whole leading paragraph is agent chrome.")
    }
}
