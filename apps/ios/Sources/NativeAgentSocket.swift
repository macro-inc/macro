import Foundation

struct NativeAgentSocketEvent: Sendable {
    var type: String
    var sessionID: String
    var entries: [NativeAgentLogEntry] = []
    var queue: [NativeAgentQueuedAction] = []
    var name: String?
    var turnState: String?
}

/// Foreground subscription. A reconnect always triggers an authoritative REST snapshot.
@MainActor
final class NativeAgentSocket {
    private let session: NativeSession
    private let transport: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        return URLSession(configuration: configuration)
    }()
    private var connection: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var generation = UUID()
    private var lastPong = Date()

    init(session: NativeSession) { self.session = session }

    func start(id: String, onEvent: @escaping (NativeAgentSocketEvent) -> Void, onConnected: @escaping () -> Void) {
        stop()
        guard !session.isDemo else { return }
        let current = generation
        connection = Task { [weak self] in
            guard let self else { return }
            var failures = 0
            while !Task.isCancelled, generation == current {
                do {
                    let token = try await session.macroAPIToken()
                    guard !Task.isCancelled, generation == current else { return }
                    var components = URLComponents(url: session.environment.connectionURL, resolvingAgainstBaseURL: false)!
                    components.queryItems = [URLQueryItem(name: "macro-api-token", value: token)]
                    guard let url = components.url else { return }
                    let active = transport.webSocketTask(with: url)
                    socket = active; active.resume()
                    try await active.send(.string("ping"))
                    try await track(id, action: "open", socket: active)
                    guard !Task.isCancelled, generation == current else { active.cancel(); return }
                    lastPong = Date(); onConnected()
                    heartbeat = Task { [weak self] in
                        var ticks = 0
                        while !Task.isCancelled {
                            do {
                                try await Task.sleep(for: .seconds(5))
                                guard let self, generation == current else { return }
                                guard Date().timeIntervalSince(lastPong) < 20 else { active.cancel(); return }
                                try await active.send(.string("ping")); ticks += 1
                                if ticks % 4 == 0 { try await track(id, action: "ping", socket: active) }
                            } catch { active.cancel(); return }
                        }
                    }
                    while !Task.isCancelled, generation == current {
                        let frame = try await active.receive()
                        let data: Data
                        switch frame {
                        case .string(let text):
                            if text == "pong" { lastPong = Date(); failures = 0; continue }
                            data = Data(text.utf8)
                        case .data(let bytes): data = bytes
                        @unknown default: continue
                        }
                        let event = try? await Task.detached(priority: .userInitiated) { try Self.decode(data) }.value
                        guard !Task.isCancelled, generation == current else { return }
                        if let event, event.sessionID == id { onEvent(event) }
                    }
                } catch { /* Never expose websocket errors containing a credential-bearing URL. */ }
                guard !Task.isCancelled, generation == current else { return }
                heartbeat?.cancel(); socket?.cancel(with: .goingAway, reason: nil); socket = nil
                failures += 1
                try? await Task.sleep(for: .seconds(min(20.0, pow(2.0, Double(min(failures - 1, 4))))))
            }
        }
    }

    func stop() {
        generation = UUID(); connection?.cancel(); heartbeat?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil; connection = nil; heartbeat = nil
    }

    private func track(_ id: String, action: String, socket: URLSessionWebSocketTask) async throws {
        let data = try JSONEncoder().encode(["type": "track_entity", "entity_type": "agent_session", "entity_id": id, "action": action])
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    nonisolated static func decode(_ data: Data) throws -> NativeAgentSocketEvent? {
        let envelope = try JSONDecoder().decode(WorkspaceJSON.self, from: data)
        guard let type = envelope["type"].string, type.hasPrefix("agent_session_") else { return nil }
        let body: WorkspaceJSON
        if let encoded = envelope["data"].string { body = try JSONDecoder().decode(WorkspaceJSON.self, from: Data(encoded.utf8)) }
        else { body = envelope["data"] }
        guard let id = body["agentSessionId"].string else { return nil }
        var event = NativeAgentSocketEvent(type: type, sessionID: id, name: body["name"].string, turnState: body["turnState"].string)
        if type == "agent_session_log" { event.entries = try JSONDecoder().decode([NativeAgentLogEntry].self, from: JSONEncoder().encode(body["entries"])) }
        if type == "agent_session_queue" { event.queue = try JSONDecoder().decode([NativeAgentQueuedAction].self, from: JSONEncoder().encode(body["entries"])) }
        return event
    }
}
