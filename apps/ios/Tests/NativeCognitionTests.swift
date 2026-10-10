import XCTest
import Observation
@testable import MacroNative

@MainActor final class NativeCognitionTests: XCTestCase {
    let origin = URL(string: "https://gateway.example.invalid")!
    func chat() -> ChatStore { ChatStore(api: MessagingAPI(baseURL: origin, tokenProvider: { "not-used" }), userID: "me") }
    func response(messages: [NativeCognitionMessage] = [], access: String = "owner") throws -> Data {
        try JSONEncoder().encode(NativeCognitionResponse(chat: .init(id: "chat-id", name: "New Chat", model: NativeCognitionAPI.models[0].id, messages: messages), userAccessLevel: access))
    }
    func testRestoringComposerDoesNotInvalidateSharedDraftObservation() throws {
        let chat = chat(); chat.setDraft("Saved prompt", channelID: "agent-new")
        withObservationTracking { _ = chat.drafts } onChange: { XCTFail("Store construction must be side-effect free inside SwiftUI body.") }
        for _ in 0..<10 {
            let model = NativeCognitionStore(session: .demo(), chat: chat)
            XCTAssertEqual(model.draft, "Saved prompt")
        }
    }
    func testCognitionRoutesAndChannelFileAttachmentContract() async throws {
        var paths: [String] = []
        let api = NativeCognitionAPI(baseURL: origin) { request in
            paths.append(request.url!.path)
            if request.url!.path == "/cognition/chats" { return Data(#"{"id":"chat-id"}"#.utf8) }
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["chat_id"].string, "chat-id")
            XCTAssertEqual(body["model"].string, "anthropic/claude-sonnet-5")
            XCTAssertEqual(body["toolset"]["type"].string, "all")
            XCTAssertEqual(body["attachments"].array.map { $0["entity_type"].string }, ["channel", "static_file"])
            XCTAssertEqual(body["botId"], .null)
            return Data(#"{"chat_id":"chat-id","stream_id":"response","message_id":"response"}"#.utf8)
        }
        let wire = #"<m-document-mention>{"documentId":"channel-id","blockName":"channel","documentName":"Engineers"}</m-document-mention> Help"#
        let refs = try NativeCognitionStore.references(content: wire, files: [.init(uri: "https://static-file-service.macro.com/file/file-id", name: "design.png")])
        let id = try await api.create()
        _ = try await api.send(wire, chatID: id, model: NativeCognitionAPI.models[0].id, attachments: refs)
        XCTAssertEqual(paths, ["/cognition/chats", "/cognition/stream/chat/message"])
    }
    func testGatewayStreamAndIncrementalTextPreserveToolBoundaries() throws {
        let frame = #"{"type":"stream","data":"{\"id\":{\"entity_type\":\"chat\",\"entity_id\":\"chat-id\",\"stream_id\":\"s\"},\"payload\":{\"type\":\"chat_message_response\",\"message_id\":\"s\",\"content\":{\"type\":\"text\",\"text\":\"Hello\"}}}"}"#
        let value = try XCTUnwrap(MessagingSocket.decodeCognitionStream(Data(frame.utf8)))
        XCTAssertEqual(value["payload"]["content"]["text"].string, "Hello")
        var parts: [WorkspaceJSON] = []
        for part in ["{\"type\":\"text\",\"text\":\"Hel\"}", "{\"type\":\"text\",\"text\":\"lo\"}", "{\"type\":\"toolCall\",\"id\":\"t\",\"name\":\"search\",\"json\":{}}", "{\"type\":\"text\",\"text\":\" Done\"}"] {
            NativeCognitionStore.append(try JSONDecoder().decode(WorkspaceJSON.self, from: Data(part.utf8)), to: &parts)
        }
        XCTAssertEqual(parts.count, 3); XCTAssertEqual(parts[0]["text"].string, "Hello")
        XCTAssertEqual(parts[1]["name"].string, "search"); XCTAssertEqual(parts[2]["text"].string, " Done")
    }
    func testDefiniteFailedDuplicateTextCannotBeMistakenForEarlierSentMessage() async throws {
        let chat = chat()
        let old = NativeCognitionMessage(id: "old", role: "user", content: .string("Same prompt"))
        let payload = try response(messages: [old])
        let api = NativeCognitionAPI(baseURL: origin) { request in
            if request.httpMethod == "POST" { throw NativeSessionError.requestFailed(403) }; return payload
        }
        let model = NativeCognitionStore(session: .demo(), chat: chat, id: "chat-id", api: api)
        await model.start(); defer { model.stopObserving() }
        let sent = await model.send(content: "Same prompt", attachments: [])
        XCTAssertFalse(sent); XCTAssertEqual(model.messages.map(\.id), ["old"])
    }
    func testUncertainSendDoesNotAutomaticallyResubmitAndCanRecoverByServerMessage() async throws {
        let chat = chat(); var messages: [NativeCognitionMessage] = [], sends = 0
        let api = NativeCognitionAPI(baseURL: origin) { request in
            if request.httpMethod == "POST" { sends += 1; throw URLError(.networkConnectionLost) }
            return try self.response(messages: messages)
        }
        let model = NativeCognitionStore(session: .demo(), chat: chat, id: "chat-id", api: api)
        model.draft = "Keep me"; await model.start(); defer { model.stopObserving() }
        let first = await model.send(content: "Keep me", attachments: [])
        XCTAssertFalse(first); XCTAssertTrue(model.uncertainSubmission)
        let second = await model.send(content: "Keep me", attachments: [])
        XCTAssertFalse(second); XCTAssertEqual(sends, 1)
        messages = [.init(id: "server-user", role: "user", content: .string("Keep me"))]
        await model.refresh()
        XCTAssertFalse(model.uncertainSubmission); XCTAssertEqual(model.messages.map(\.id), ["server-user"]); XCTAssertEqual(model.draft, "")
    }
    func testLiveStreamRekeysOptimisticUserAndSurvivesObserverRestart() async throws {
        let api = NativeCognitionAPI(baseURL: origin, isDemo: true) { _ in XCTFail("Fixture only"); return Data() }
        let model = NativeCognitionStore(session: .demo(), chat: chat(), id: "chat-id", api: api)
        await model.start(); model.stopObserving(); await model.start(); defer { model.stopObserving() }
        model.enqueue(.object(["id": .object(["entity_id": .string("chat-id"), "stream_id": .string("answer")]), "payload": .object(["type": .string("chat_message_response"), "message_id": .string("answer"), "content": .object(["type": .string("text"), "text": .string("Native response")])])]))
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertEqual(model.messages.last?.text, "Native response"); XCTAssertTrue(model.isStreaming)
    }
    func testRealHistoryDecodesStringStructuredAndMissingAttachments() throws {
        let json = #"{"chat":{"id":"chat-id","name":"New Chat","model":"anthropic/claude-sonnet-5","userId":"macro|me@example.com","messages":[{"id":"u","role":"user","content":"Question","attachments":null},{"id":"a","role":"assistant","content":[{"type":"thinking","thinking":"Consider"},{"type":"text","text":"Answer"}]}]},"userAccessLevel":"owner"}"#
        let result = try JSONDecoder().decode(NativeCognitionResponse.self, from: Data(json.utf8))
        XCTAssertEqual(result.chat.messages.map(\.text), ["Question", "Answer"])
        XCTAssertEqual(result.chat.messages.map(\.attachments), [[], []])
    }
    func testStreamEndBeforeHTTPSendResponseDoesNotLeaveRunningState() async throws {
        var model: NativeCognitionStore!
        var history: [NativeCognitionMessage] = []
        let api = NativeCognitionAPI(baseURL: origin) { request in
            if request.url?.path.hasSuffix("stream/chat/message") == true {
                history = [.init(id: "user-id", role: "user", content: .string("Hello")), .init(id: "message-id", role: "assistant", content: .array([.object(["type": .string("text"), "text": .string("Done")])]))]
                model.enqueue(.object(["id": .object(["entity_id": .string("chat-id"), "stream_id": .string("distinct-stream-id")]), "payload": .object(["type": .string("stream_end"), "stream_id": .string("distinct-stream-id")])]))
                model.fold()
                return Data(#"{"chat_id":"chat-id","stream_id":"distinct-stream-id","message_id":"message-id"}"#.utf8)
            }
            return try self.response(messages: history)
        }
        model = NativeCognitionStore(session: .demo(), chat: chat(), id: "chat-id", api: api)
        await model.start(); defer { model.stopObserving() }
        let sent = await model.send(content: "Hello", attachments: [])
        XCTAssertTrue(sent); XCTAssertFalse(model.isStreaming)
        XCTAssertEqual(model.messages.map(\.id), ["user-id", "message-id"])
    }
    func testChatTrackingAndReplayDoNotDuplicateAssistantText() async throws {
        let tracking = try JSONDecoder().decode(WorkspaceJSON.self, from: NativeCognitionSocket.trackingData(id: "chat-id", action: "open"))
        XCTAssertEqual(tracking["entity_type"].string, "chat"); XCTAssertEqual(tracking["type"].string, "track_entity")
        let api = NativeCognitionAPI(baseURL: origin, isDemo: true) { _ in XCTFail("Fixture only"); return Data() }
        let model = NativeCognitionStore(session: .demo(), chat: chat(), id: "chat-id", api: api)
        await model.start(); defer { model.stopObserving() }
        func frame(_ text: String) -> WorkspaceJSON { .object(["id": .object(["entity_id": .string("chat-id"), "stream_id": .string("s")]), "payload": .object(["type": .string("chat_message_response"), "message_id": .string("a"), "content": .object(["type": .string("text"), "text": .string(text)])])]) }
        model.enqueue(frame("Hello")); model.fold()
        model.beginReplay(); model.enqueue(frame("Hello")); model.enqueue(frame(" world")); model.fold()
        XCTAssertEqual(model.messages.count, 1); XCTAssertEqual(model.messages.first?.text, "Hello world")
    }
    func testNewChatDraftIdentityClearsOnlyAfterConfirmedSend() async throws {
        let chat = chat()
        let api = NativeCognitionAPI(baseURL: origin, isDemo: true) { _ in XCTFail("Fixture only"); return Data() }
        let model = NativeCognitionStore(session: .demo(), chat: chat, api: api)
        await model.start(); defer { model.stopObserving() }
        let id = try XCTUnwrap(model.id)
        XCTAssertEqual(chat.drafts["agent-new-cognition-id"], id)
        let sent = await model.send(content: "A separate chat", attachments: [])
        XCTAssertTrue(sent); XCTAssertEqual(model.id, id)
        XCTAssertTrue(chat.drafts["agent-new-cognition-id"]?.isEmpty != false)
        XCTAssertNil(NativeCognitionStore(session: .demo(), chat: chat).id)
    }
    func testViewAccessDeniesSending() async throws {
        let payload = try response(access: "view"); var writes = 0
        let api = NativeCognitionAPI(baseURL: origin) { request in if request.httpMethod == "POST" { writes += 1 }; return payload }
        let model = NativeCognitionStore(session: .demo(), chat: chat(), id: "chat-id", api: api)
        await model.start(); defer { model.stopObserving() }
        let sent = await model.send(content: "Do not send", attachments: [])
        XCTAssertFalse(sent); XCTAssertEqual(writes, 0)
    }
}
