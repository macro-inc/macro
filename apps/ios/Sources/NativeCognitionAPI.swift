import Foundation

struct NativeCognitionAttachment: Codable, Equatable, Sendable {
    var entity_id: String
    var entity_type: String
}

struct NativeCognitionMessage: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var role: String
    var content: WorkspaceJSON
    var attachments: [NativeCognitionAttachment] = []
    init(id: String, role: String, content: WorkspaceJSON, attachments: [NativeCognitionAttachment] = []) {
        self.id = id; self.role = role; self.content = content; self.attachments = attachments
    }
    enum CodingKeys: String, CodingKey { case id, role, content, attachments }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id); role = try values.decode(String.self, forKey: .role)
        content = try values.decode(WorkspaceJSON.self, forKey: .content)
        attachments = try values.decodeIfPresent([NativeCognitionAttachment].self, forKey: .attachments) ?? []
    }
    var parts: [WorkspaceJSON] { content.string.map { [.object(["type": .string("text"), "text": .string($0)])] } ?? content.array }
    var text: String { parts.compactMap { $0["text"].string }.joined() }
}

struct NativeCognitionRecord: Codable, Sendable {
    var id: String
    var name: String
    var model: String?
    var messages: [NativeCognitionMessage]
}
struct NativeCognitionResponse: Codable, Sendable {
    var chat: NativeCognitionRecord
    var userAccessLevel: String
}
struct NativeCognitionSendResult: Codable, Sendable {
    var chat_id: String
    var message_id: String
    var stream_id: String
}

@MainActor
final class NativeCognitionAPI {
    static let models: [(id: String, name: String)] = [
        ("anthropic/claude-sonnet-5", "Sonnet 5"), ("anthropic/claude-opus-5", "Opus 5"),
        ("anthropic/claude-fable-5-1", "Fable 5.1"), ("anthropic/claude-haiku-4-5", "Haiku 4.5"),
        ("openai/gpt-6-astra", "GPT-6 Astra"), ("openai/gpt-5.6", "GPT-5.6"), ("openai/gpt-5.6-mini", "GPT-5.6 mini")
    ]
    let isDemo: Bool
    private let baseURL: URL
    private let requestData: @MainActor (URLRequest) async throws -> Data
    private var demoChats: [String: NativeCognitionRecord] = [:]
    init(session: NativeSession) {
        isDemo = session.isDemo; baseURL = session.environment.gatewayURL
        requestData = { try await session.authenticatedData(for: $0) }
    }
    init(baseURL: URL, isDemo: Bool = false, request: @escaping @MainActor (URLRequest) async throws -> Data) {
        self.baseURL = baseURL; self.isDemo = isDemo; requestData = request
    }
    func create() async throws -> String {
        if isDemo {
            let id = MessageID.new(); demoChats[id] = .init(id: id, name: "New Chat", model: Self.models[0].id, messages: []); return id
        }
        struct Response: Decodable, Sendable { let id: String }
        let response: Response = try await decode(try await request("chats", method: "POST", body: .object([:])))
        return response.id
    }
    func get(_ id: String) async throws -> NativeCognitionResponse {
        if isDemo { return .init(chat: demoChats[id] ?? .init(id: id, name: "New Chat", model: Self.models[0].id, messages: []), userAccessLevel: "owner") }
        return try await decode(try await request("chats/" + id))
    }
    func send(_ content: String, chatID: String, model: String, attachments: [NativeCognitionAttachment]) async throws -> NativeCognitionSendResult {
        if isDemo {
            var chat = demoChats[chatID] ?? .init(id: chatID, name: "New Chat", model: model, messages: [])
            let responseID = MessageID.new()
            chat.messages += [.init(id: MessageID.new(), role: "user", content: .string(content), attachments: attachments),
                              .init(id: responseID, role: "assistant", content: .array([.object(["type": .string("text"), "text": .string("I’m ready to help. What would you like to explore next?")])]))]
            chat.model = model; chat.name = String(MentionCodec.displayText(in: content).prefix(70)); demoChats[chatID] = chat
            return .init(chat_id: chatID, message_id: responseID, stream_id: responseID)
        }
        return try await decode(try await request("stream/chat/message", method: "POST", body: Self.sendBody(content, chatID: chatID, model: model, attachments: attachments)))
    }
    nonisolated static func sendBody(_ content: String, chatID: String, model: String, attachments: [NativeCognitionAttachment]) -> WorkspaceJSON {
        var body: [String: WorkspaceJSON] = ["chat_id": .string(chatID), "content": .string(content), "model": .string(model), "toolset": .object(["type": .string("all")])]
        if !attachments.isEmpty { body["attachments"] = .array(attachments.map { .object(["entity_id": .string($0.entity_id), "entity_type": .string($0.entity_type)]) }) }
        return .object(body)
    }
    func stop(chatID: String, streamID: String) async throws {
        guard !isDemo else { return }
        _ = try await request("stream/chat/message/stop", method: "POST", body: .object(["chat_id": .string(chatID), "stream_id": .string(streamID)]))
    }
    func rename(_ id: String, name: String) async throws {
        if isDemo { demoChats[id]?.name = name; return }
        _ = try await request("chats/" + id, method: "PATCH", body: .object(["name": .string(name)]))
    }
    func tool(chatID: String, messageID: String, callID: String, accept: Bool) async throws {
        guard !isDemo else { return }
        _ = try await request("chats/\(chatID)/tool/" + (accept ? "call" : "reject"), method: "POST", body: .object(["messageId": .string(messageID), "toolCallId": .string(callID)]))
    }
    private func request(_ path: String, method: String = "GET", body: WorkspaceJSON? = nil) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent("cognition/" + path))
        request.httpMethod = method; request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try await requestData(request)
    }
    private func decode<T: Decodable & Sendable>(_ data: Data) async throws -> T {
        try await Task.detached(priority: .userInitiated) { try JSONDecoder().decode(T.self, from: data) }.value
    }
}
