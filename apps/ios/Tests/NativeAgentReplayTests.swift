import XCTest
@testable import MacroNative

final class NativeAgentReplayTests: XCTestCase {
    private func row(_ id: String, _ direction: String, _ json: String) throws -> NativeAgentLogEntry {
        .init(id: id, createdAt: id, direction: direction, content: try JSONDecoder().decode(WorkspaceJSON.self, from: Data(json.utf8)))
    }
    func testReplayStaysStagedThenReplacesHistoryOnlyOnMatchingSuccess() throws {
        let original = NativeAgentFixtures.turn(prompt: "Original", answer: "Old answer", actionID: "old")
        let load = try row("load", "to_runtime", #"{"type":"acp","id":7,"method":"session/load","params":{"sessionId":"acp-session"}}"#)
        let user = try row("replay-user", "to_server", #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"Restored prompt"}}}}"#)
        let answer = try row("replay-answer", "to_server", #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Restored answer"}}}}"#)
        let wrongID = try row("wrong", "to_server", #"{"type":"acp","id":"7","result":{}}"#)
        let partial = original + [load, user, answer, wrongID]
        XCTAssertEqual(NativeAgentTranscript.fold(partial).parts.filter { $0.kind == .text }.map(\.text), ["Old answer"])
        let commit = try row("commit", "to_server", #"{"type":"acp","id":7,"result":{}}"#)
        let complete = NativeAgentTranscript.fold(partial + [commit])
        XCTAssertEqual(complete.parts.map(\.text), ["Restored prompt", "Restored answer"])
        XCTAssertEqual(ChannelAgentSummary.project(partial + [commit])[0]?.text, "Restored answer")
    }
    func testFailedReplayKeepsCommittedHistoryAndDropsTrailingNotifications() throws {
        let original = NativeAgentFixtures.turn(prompt: "Original", answer: "Old answer", actionID: "old")
        let load = try row("load", "to_runtime", #"{"type":"acp","id":7,"method":"session/load","params":{"sessionId":"acp-session"}}"#)
        let failure = try row("failure", "to_server", #"{"type":"acp","id":7,"error":{"code":-1,"message":"Could not restore"}}"#)
        let stale = try row("stale", "to_server", #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Stale replay"}}}}"#)
        let next = NativeAgentFixtures.turn(prompt: "Continue", answer: "Live answer", actionID: "live")
        let projected = NativeAgentTranscript.fold(original + [load, failure, stale] + next)
        XCTAssertEqual(projected.parts.filter { $0.kind == .text }.map(\.text), ["Old answer", "Live answer"])
        XCTAssertFalse(projected.parts.contains { $0.text == "Stale replay" })
    }

    func testDisconnectedPromptDoesNotKeepNextCompletedTurnWorking() throws {
        let abandoned = NativeAgentFixtures.turn(prompt: "Original", answer: "Started", actionID: "old")
        let disconnected = try row("disconnect", "to_server", #"{"type":"event","event":"disconnected"}"#)
        let initialize = try row("initialize", "to_runtime", #"{"type":"acp","id":8,"method":"initialize","params":{}}"#)
        let next = NativeAgentFixtures.turn(prompt: "Continue", answer: "Live answer", actionID: "live")
        let projected = NativeAgentTranscript.fold(Array(abandoned.prefix(2)) + [disconnected, initialize] + next)
        XCTAssertFalse(projected.isWorking)
        XCTAssertEqual(projected.parts.filter { $0.kind == .text }.map(\.text), ["Started", "Live answer"])
    }
}
