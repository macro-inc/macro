import XCTest
import Observation
@testable import MacroNative

@MainActor
final class NativeAgentTests: XCTestCase {
    private let origin = URL(string: "https://gateway.example.invalid")!
    private let sessionJSON = #"{"id":"session","name":"Review the launch","ownerId":"macro|me@example.com","botId":"00000000-0000-0000-0000-00000000a1a1","harness":"in-memory","model":"model-id","canEdit":true,"status":{"kind":"event","event":"acp_ready"},"repoUrl":"https://github.com/macro-inc/macro","pullRequestUrl":null,"workspace":"/repo","sandboxSize":"small","createdAt":"2026-09-27T12:00:00Z","modifiedAt":"2026-09-27T12:00:00Z"}"#

    func testConstructingDestinationStoreDoesNotMutateObservedSharedDrafts() throws {
        let chat = ChatStore(api: MessagingAPI(baseURL: origin, tokenProvider: { "never-requested" }), userID: "me")
        let attachment = NativeAgentPromptAttachment(uri: "https://files.example.invalid/draft.pdf", name: "draft.pdf")
        chat.setDraft("Saved prompt", channelID: "agent:session")
        chat.setDraft(String(decoding: try JSONEncoder().encode([attachment]), as: UTF8.self), channelID: "agent-attachments:session")
        withObservationTracking {
            _ = chat.drafts
        } onChange: {
            XCTFail("Restoring State during SwiftUI body evaluation must not invalidate its observed parent.")
        }
        let api = NativeAgentAPI(baseURL: origin, isDemo: true) { _ in XCTFail("No request during construction"); return Data() }
        for _ in 0..<10 {
            let store = NativeAgentStore(id: "session", api: api, draftStore: chat)
            XCTAssertEqual(store.draft, "Saved prompt")
            XCTAssertEqual(store.draftAttachments, [attachment])
        }
    }

    func testCreateNamesMacroPersonaAndUsesCallerIDWithoutExternalWorkspace() async throws {
        let response = sessionJSON
        let api = NativeAgentAPI(baseURL: origin) { request in
            XCTAssertEqual(request.url?.path, "/agent-harness/agent-sessions")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["id"].string, "stable-creation-id")
            XCTAssertEqual(body["botId"].string, NativeAgentAPI.macroBotID)
            XCTAssertEqual(body["prompt"].string, "Help plan the launch")
            XCTAssertEqual(body["workspace"], .null)
            return Data(("{\"session\":" + response + "}").utf8)
        }
        let record = try await api.create(prompt: "Help plan the launch", id: "stable-creation-id")
        XCTAssertTrue(record.canEdit)
        XCTAssertNil(record.repository, "The default repo on Macro chat metadata must not appear as a coding workspace.")
    }

    func testCreateWithAttachmentsOpensIdleAndRetriesIdenticalControlAfterLostResponse() async throws {
        let id = MessageID.new()
        let response = sessionJSON.replacingOccurrences(of: #""id":"session""#, with: "\"id\":\"" + id + "\"")
        let attachment = NativeAgentPromptAttachment(uri: "https://files.example.invalid/design.pdf", name: "design.pdf", mimeType: "application/pdf", size: 72)
        var creates = 0, prompts: [WorkspaceJSON] = []
        let api = NativeAgentAPI(baseURL: origin) { request in
            if request.url?.path.hasSuffix("/control") == true {
                let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
                prompts.append(body)
                if prompts.count == 1 { throw URLError(.networkConnectionLost) }
                return try JSONEncoder().encode(WorkspaceJSON.object(["actionId": .string(id), "status": .string("sent")]))
            }
            if request.httpMethod == "POST" {
                creates += 1
                let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
                XCTAssertEqual(body["prompt"], .null, "Attachment create opens idle because create only accepts a string prompt.")
                XCTAssertEqual(body["attachments"], .null)
                if creates > 1 { throw NativeSessionError.requestFailed(409) }
                return Data(("{\"session\":" + response + "}").utf8)
            }
            return Data(response.utf8)
        }
        do { _ = try await api.create(prompt: "Review the file", id: id, attachments: [attachment]); XCTFail("Simulated response loss") }
        catch is URLError { }
        _ = try await api.create(prompt: "Changed after uncertain send", id: id, attachments: [])
        XCTAssertEqual(prompts.count, 2)
        XCTAssertEqual(prompts[0], prompts[1], "A retry must retain the originally submitted text and file references.")
        XCTAssertEqual(prompts[0]["actionId"].string, id)
        XCTAssertNotNil(UUID(uuidString: id), "Control accepts a UUID, not an id plus a textual suffix.")
        XCTAssertEqual(prompts[0]["attachments"].array.first?["uri"].string, attachment.uri)
    }

    func testAttachmentOnlyDemoCreateShowsTheFileInNativeTranscript() async throws {
        let api = NativeAgentAPI(baseURL: origin, isDemo: true) { _ in XCTFail("Demo never requests network"); return Data() }
        let attachment = NativeAgentPromptAttachment(uri: "https://files.example.invalid/design.pdf", name: "design.pdf")
        let id = MessageID.new()
        _ = try await api.create(prompt: "", id: id, attachments: [attachment])
        _ = try await api.create(prompt: "", id: id, attachments: [attachment])
        let transcript = NativeAgentTranscript.fold(try await api.log(id).entries)
        XCTAssertEqual(transcript.parts.filter { $0.kind == .user }.map(\.text), ["design.pdf"])
    }

    func testPromptRetryReusesAcceptedActionIDAndPermissionKeepsNumericRPCIdentity() async throws {
        var requests: [WorkspaceJSON] = []
        let api = NativeAgentAPI(baseURL: origin) { request in
            XCTAssertEqual(request.url?.path, "/agent-harness/agent-sessions/session/control")
            requests.append(try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody)))
            return Data(#"{"actionId":"stable-action","status":"queued"}"#.utf8)
        }
        let first = try await api.prompt("Please continue", sessionID: "session", actionID: "stable-action")
        _ = try await api.prompt("Please continue", sessionID: "session", actionID: "stable-action")
        let permission = NativeAgentPermission(requestID: .number(7), options: [.object(["optionId": .string("allow-once")])])
        try await api.answer(permission, optionID: "allow-once", sessionID: "session")
        XCTAssertEqual(first.status, "queued")
        XCTAssertEqual(requests[0], requests[1])
        XCTAssertEqual(requests[2]["type"].string, "respondToPermission")
        XCTAssertEqual(requests[2]["requestId"], .number(7))
        XCTAssertEqual(requests[2]["answer"]["kind"].string, "selected")
        XCTAssertEqual(requests[2]["answer"]["optionId"].string, "allow-once")
    }

    func testACPTranscriptCombinesTextAndUpdatesToolsWithoutProtocolNoise() throws {
        let frames = [
            #"{"type":"acp","id":"prompt-1","method":"session/prompt","params":{"prompt":[{"type":"text","text":"List files"}]}}"#,
            #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Sure, "}}}}"#,
            #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"one moment."}}}}"#,
            #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"Inspect the repository"}}}}"#,
            #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"tool-1","kind":"execute","title":"ls examples","status":"pending","rawInput":{"command":"ls examples"}}}}"#,
            #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"tool-1","status":"completed","_meta":{"terminal_output":{"data":"\u001b[32mmain.swift\u001b[0m"}}}}}"#,
            #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Done."}}}}"#,
            #"{"type":"acp","id":"prompt-1","result":{"stopReason":"end_turn"}}"#
        ]
        let entries = try frames.enumerated().map { index, json in
            NativeAgentLogEntry(id: String(index), createdAt: String(index), direction: index == 0 ? "to_runtime" : "to_server", content: try JSONDecoder().decode(WorkspaceJSON.self, from: Data(json.utf8)))
        }
        let transcript = NativeAgentTranscript.fold(entries + entries)
        XCTAssertEqual(transcript.parts.map(\.kind), [.user, .text, .thought, .tool, .text])
        XCTAssertEqual(transcript.parts[1].text, "Sure, one moment.")
        XCTAssertEqual(transcript.parts[3].text, "main.swift")
        XCTAssertEqual(transcript.parts[3].status, "completed")
        XCTAssertEqual(transcript.parts[3].detail, "ls examples")
        XCTAssertFalse(transcript.isWorking)
        XCTAssertTrue(transcript.promptIDs.contains("prompt-1"))
    }

    func testPermissionResponseDistinguishesNumberAndStringAndDoesNotAutoApprove() throws {
        var transcript = NativeAgentTranscript()
        func frame(_ id: String, direction: String, json: String) throws -> NativeAgentLogEntry {
            .init(id: id, createdAt: id, direction: direction, content: try JSONDecoder().decode(WorkspaceJSON.self, from: Data(json.utf8)))
        }
        transcript.ingest(try frame("a", direction: "to_server", json: #"{"type":"acp","id":7,"method":"session/request_permission","params":{"toolCall":{"title":"Run tests"},"options":[{"kind":"allow_once","name":"Allow once","optionId":"allow"}]}}"#))
        XCTAssertTrue(transcript.isWaiting)
        XCTAssertEqual(transcript.parts[0].permission?.answered, false)
        transcript.ingest(try frame("b", direction: "to_runtime", json: #"{"type":"acp","id":"7","result":{"outcome":{"outcome":"selected","optionId":"allow"}}}"#))
        XCTAssertTrue(transcript.isWaiting)
        transcript.ingest(try frame("c", direction: "to_runtime", json: #"{"type":"acp","id":7,"result":{"outcome":{"outcome":"selected","optionId":"allow"}}}"#))
        XCTAssertFalse(transcript.isWaiting)
        XCTAssertEqual(transcript.parts[0].permission?.answered, true)
    }

    func testSocketDecodesGatewayStringPayloadAndQueueSnapshot() throws {
        let entry = NativeAgentFixtures.entries[0]
        let body: WorkspaceJSON = .object(["agentSessionId": .string("session"), "entries": try JSONDecoder().decode(WorkspaceJSON.self, from: JSONEncoder().encode([entry]))])
        let text = String(decoding: try JSONEncoder().encode(body), as: UTF8.self)
        let envelope: WorkspaceJSON = .object(["type": .string("agent_session_log"), "data": .string(text)])
        let event = try XCTUnwrap(NativeAgentSocket.decode(JSONEncoder().encode(envelope)))
        XCTAssertEqual(event.sessionID, "session")
        XCTAssertEqual(event.entries, [entry])
        let queue = try XCTUnwrap(NativeAgentSocket.decode(Data(#"{"type":"agent_session_queue","data":{"agentSessionId":"session","entries":[{"actionId":"queued","kind":"prompt","prompt":"Continue","createdAt":"2026-09-27T12:00:00Z"}]}}"#.utf8)))
        XCTAssertEqual(queue.queue[0].prompt, "Continue")
    }

    func testDemoConversationSendsNativelyAndDeduplicatesSocketOverlapWithoutNetwork() async throws {
        let api = NativeAgentAPI(baseURL: origin, isDemo: true) { _ in XCTFail("Demo must never request the network"); return Data() }
        let store = NativeAgentStore(id: "demo", api: api)
        await store.start()
        XCTAssertFalse(store.transcript.isWorking)
        XCTAssertEqual(store.transcript.parts.count, 4)
        XCTAssertEqual(store.transcript.parts.filter { $0.kind == .tool }.count, 2)
        store.draft = "Ship the launch checklist"
        let actionID = try XCTUnwrap(store.send())
        for _ in 0..<200 where !store.pending.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(store.pending.isEmpty)
        XCTAssertTrue(store.transcript.parts.contains { $0.kind == .user && $0.text == "Ship the launch checklist" })
        XCTAssertTrue(store.transcript.promptIDs.contains(actionID))
        XCTAssertFalse(store.transcript.isWorking)
        let log = try await api.log("demo")
        store.receive(.init(type: "agent_session_log", sessionID: "demo", entries: log.entries))
        try await Task.sleep(for: .milliseconds(70))
        XCTAssertEqual(store.transcript.parts.count, 6)
        store.stopObserving()
    }
    func testAttachmentOnlySendAndFailedRetryKeepReferencesAndStableIDInOutbox() async throws {
        let response = sessionJSON
        var sent: [WorkspaceJSON] = []
        let api = NativeAgentAPI(baseURL: origin) { request in
            if request.url?.path.hasSuffix("/control") == true {
                sent.append(try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody)))
                throw URLError(.networkConnectionLost)
            }
            if request.url?.path.hasSuffix("/log") == true {
                return Data(#"{"bot":{"id":"bot","name":"Macro","handle":"macro"},"entries":[]}"#.utf8)
            }
            if request.url?.path.hasSuffix("/queue") == true { return Data(#"{"entries":[]}"#.utf8) }
            return Data(response.utf8)
        }
        let chat = ChatStore(api: MessagingAPI(baseURL: origin, tokenProvider: { "never-requested" }), userID: "me")
        let store = NativeAgentStore(id: "session", api: api, draftStore: chat)
        await store.start()
        let attachment = NativeAgentPromptAttachment(uri: "https://static-file-service.macro.com/file/id", name: "launch.pdf", mimeType: "application/pdf", size: 1024)
        store.draftAttachments = [attachment]
        let actionID = try XCTUnwrap(store.send())
        for _ in 0..<100 where store.pending.first?.state != "Failed" { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(store.draftAttachments.isEmpty)
        XCTAssertEqual(sent[0]["prompt"].string, "")
        XCTAssertEqual(sent[0]["attachments"].array[0]["uri"].string, attachment.uri)
        XCTAssertEqual(sent[0]["attachments"].array[0]["size"].number, 1024)
        XCTAssertEqual(sent[0]["attachments"].array[0]["id"], .null)
        store.stopObserving()
        let reopened = NativeAgentStore(id: "session", api: api, draftStore: chat)
        XCTAssertEqual(reopened.pending.first?.id, actionID)
        XCTAssertEqual(reopened.pending.first?.attachments, [attachment])
        await reopened.start()
        reopened.retry(try XCTUnwrap(reopened.pending.first))
        for _ in 0..<100 where sent.count < 2 { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertEqual(sent, [sent[0], sent[0]])
        reopened.stopObserving()
    }

    func testCreateConflictRecoversExistingSessionWithoutDuplicatingInitialPrompt() async throws {
        let response = sessionJSON
        var requests: [String] = []
        let api = NativeAgentAPI(baseURL: origin) { request in
            requests.append(request.httpMethod ?? "")
            if request.httpMethod == "POST" { throw NativeSessionError.requestFailed(409) }
            XCTAssertEqual(request.url?.path, "/agent-harness/agent-sessions/session")
            return Data(response.utf8)
        }
        let record = try await api.create(prompt: "The already accepted prompt", id: "session")
        XCTAssertEqual(record.id, "session")
        XCTAssertEqual(requests, ["POST", "GET"])
    }

    func testLaggingSnapshotDoesNotRetractKnownLiveRowsAfterHistoryBoundary() async throws {
        let response = sessionJSON
        let initial = NativeAgentFixtures.entries
        let api = NativeAgentAPI(baseURL: origin) { request in
            if request.url?.path.hasSuffix("/log") == true {
                let rows = String(decoding: try JSONEncoder().encode(initial), as: UTF8.self)
                return Data((#"{"bot":{"id":"bot","name":"Macro","handle":"macro"},"entries":"# + rows + "}").utf8)
            }
            if request.url?.path.hasSuffix("/queue") == true { return Data(#"{"entries":[]}"#.utf8) }
            return Data(response.utf8)
        }
        let store = NativeAgentStore(id: "session", api: api)
        await store.start()
        let live = NativeAgentFixtures.turn(prompt: "Live prompt", answer: "Live answer", actionID: "live")
        store.receive(.init(type: "agent_session_log", sessionID: "session", entries: live))
        try await Task.sleep(for: .milliseconds(60))
        await store.refresh()
        XCTAssertTrue(store.transcript.parts.contains { $0.text == "Live answer" })
        XCTAssertEqual(store.transcript.parts.count, 6)
        store.stopObserving()
    }

    func testChangesAndPatchReadActualCaptureContractsWithoutRefreshMutation() async throws {
        var paths: [String] = []
        let api = NativeAgentAPI(baseURL: origin) { request in
            XCTAssertEqual(request.httpMethod, "GET")
            paths.append(request.url!.path)
            if request.url!.path.hasSuffix("/patch") { return Data(#"{"patch":"diff --git a/a.md b/a.md\n+native"}"#.utf8) }
            return Data(#"{"capturing":false,"attempt":{"startedAt":"2026-09-27T12:00:00Z","outcome":"captured"},"changeset":{"id":"capture","additions":12,"deletions":3,"files":[{"path":"a.md","kind":"modified","additions":12,"deletions":3,"binary":false,"patchOmitted":false}],"truncated":false,"capturedAt":"2026-09-27T12:00:00Z","patchBytes":42,"source":"runtime","base":{"sha":"a"},"head":{"sha":"b"}}}"#.utf8)
        }
        let changes = try await api.changes("session")
        let patch = try await api.patch("session")
        XCTAssertEqual(changes.changeset?.files.first?.path, "a.md")
        XCTAssertEqual(changes.changeset?.additions, 12)
        XCTAssertTrue(patch.contains("+native"))
        XCTAssertEqual(paths, ["/agent-harness/agent-sessions/session/changes", "/agent-harness/agent-sessions/session/changes/patch"])
    }

    func testToolsAreScopedToTurnAndCanceledRequestsStopOfferingPermission() throws {
        func row(_ id: String, _ direction: String, _ json: String) throws -> NativeAgentLogEntry {
            .init(id: id, createdAt: id, direction: direction, content: try JSONDecoder().decode(WorkspaceJSON.self, from: Data(json.utf8)))
        }
        let entries = try [
            row("1", "to_runtime", #"{"type":"acp","id":"first","method":"session/prompt","params":{"prompt":[{"type":"text","text":"First"}]}}"#),
            row("2", "to_server", #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"reused","title":"First tool","status":"completed"}}}"#),
            row("3", "to_server", #"{"type":"acp","id":"first","result":{"stopReason":"end_turn"}}"#),
            row("4", "to_runtime", #"{"type":"acp","id":"second","method":"session/prompt","params":{"prompt":[{"type":"text","text":"Second"}]}}"#),
            row("5", "to_server", #"{"type":"acp","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"reused","title":"Second tool","status":"pending"}}}"#),
            row("6", "to_server", #"{"type":"acp","id":7,"method":"session/request_permission","params":{"options":[{"name":"Allow","optionId":"allow"}]}}"#),
            row("7", "to_server", #"{"type":"acp","id":"second","result":{"stopReason":"cancelled"}}"#)
        ]
        let transcript = NativeAgentTranscript.fold(entries)
        XCTAssertEqual(transcript.parts.filter { $0.kind == .tool }.map(\.title), ["First tool", "Second tool"])
        XCTAssertFalse(transcript.isWorking)
        XCTAssertFalse(transcript.isWaiting)
        XCTAssertEqual(transcript.parts.last?.status, "Canceled")
        XCTAssertEqual(transcript.parts.last?.permission?.answered, true)
    }

    func testStopDuringDebounceThenRestartStillFoldsNewLiveMessages() async throws {
        let api = NativeAgentAPI(baseURL: origin, isDemo: true) { _ in XCTFail(); return Data() }
        let store = NativeAgentStore(id: "demo", api: api)
        await store.start()
        store.receive(.init(type: "agent_session_log", sessionID: "demo", entries: NativeAgentFixtures.turn(prompt: "Before background", answer: "Before response", actionID: "before")))
        store.stopObserving()
        await store.start()
        store.receive(.init(type: "agent_session_log", sessionID: "demo", entries: NativeAgentFixtures.turn(prompt: "After foreground", answer: "After response", actionID: "after", date: Date().addingTimeInterval(1))))
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertTrue(store.transcript.parts.contains { $0.text == "After response" }, "Unexpected transcript: \(store.transcript.parts.map(\.text))")
        store.stopObserving()
    }

    func testReadOnlySessionCannotRetryRestoredPendingPrompt() async throws {
        var writable = true
        var sends = 0
        let response = sessionJSON
        let api = NativeAgentAPI(baseURL: origin) { request in
            if request.url!.path.hasSuffix("/control") { sends += 1; throw URLError(.networkConnectionLost) }
            if request.url!.path.hasSuffix("/log") { return Data(#"{"bot":{"id":"bot","name":"Macro","handle":"macro"},"entries":[]}"#.utf8) }
            if request.url!.path.hasSuffix("/queue") { return Data(#"{"entries":[]}"#.utf8) }
            return Data((writable ? response : response.replacingOccurrences(of: #""canEdit":true"#, with: #""canEdit":false"#)).utf8)
        }
        let store = NativeAgentStore(id: "session", api: api)
        await store.start(); store.draft = "Retry me"; _ = store.send()
        for _ in 0..<100 where store.pending.first?.state != "Failed" { try await Task.sleep(for: .milliseconds(5)) }
        writable = false; await store.refresh()
        store.retry(try XCTUnwrap(store.pending.first))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(sends, 1)
        store.stopObserving()
    }

    func testAccessDenialRejectsLateChangesResponse() async throws {
        let response = sessionJSON
        var denied = false
        var continuation: CheckedContinuation<Data, Error>?
        let api = NativeAgentAPI(baseURL: origin) { request in
            if request.url!.path.hasSuffix("/changes") { return try await withCheckedThrowingContinuation { continuation = $0 } }
            if denied { throw NativeSessionError.requestFailed(403) }
            if request.url!.path.hasSuffix("/log") { return Data(#"{"bot":{"id":"bot","name":"Macro","handle":"macro"},"entries":[]}"#.utf8) }
            if request.url!.path.hasSuffix("/queue") { return Data(#"{"entries":[]}"#.utf8) }
            return Data(response.utf8)
        }
        let store = NativeAgentStore(id: "session", api: api)
        await store.start()
        let loading = Task { await store.refreshChanges() }
        for _ in 0..<100 where continuation == nil { await Task.yield() }
        denied = true; await store.refresh()
        continuation?.resume(returning: Data(#"{"capturing":false,"changeset":{"id":"stale","additions":1,"deletions":0,"files":[],"truncated":false,"capturedAt":"2026-09-27T12:00:00Z"}}"#.utf8))
        await loading.value
        XCTAssertNil(store.record)
        XCTAssertNil(store.changes)
        XCTAssertTrue(store.transcript.parts.isEmpty)
    }

}
