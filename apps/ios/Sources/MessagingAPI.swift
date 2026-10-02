import Foundation

@MainActor
protocol MessagingService {
    func channels(cursor: String?) async throws -> ChannelPage
    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage
    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage
    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment]) async throws -> ChatMessage
    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage
    func thread(channelID: String, rootID: String) async throws -> ChannelThread
    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment], threadID: String?) async throws -> ChatMessage
    func userNames(userIDs: [String]) async throws -> [String: String]
    func userPhotos(userIDs: [String]) async throws -> [String: URL]
}

extension MessagingService {
    func thread(channelID: String, rootID: String) async throws -> ChannelThread { throw MessagingError.invalidResponse }
    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment], threadID: String?) async throws -> ChatMessage {
        guard threadID == nil else { throw MessagingError.invalidResponse }
        return try await send(channelID: channelID, content: content, nonce: nonce, attachments: attachments)
    }
    func userPhotos(userIDs: [String]) async throws -> [String: URL] { [:] }
    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment]) async throws -> ChatMessage {
        guard attachments.isEmpty else { throw MessagingError.invalidAttachments("Attachments are unavailable in this connection.") }
        return try await send(channelID: channelID, content: content, nonce: nonce)
    }
}

enum MessagingError: LocalizedError {
    case invalidResponse
    case http(Int)
    case inconsistentRetry
    case expiredDraft
    case invalidAttachments(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Macro returned an unexpected response."
        case .http(401): return "Your session expired. Sign in again to continue."
        case .http(403): return "You no longer have access to this conversation."
        case .http(404): return "This conversation could not be found."
        case .http(429): return "Too many requests. Try again in a moment."
        case .http(let code): return "Macro could not complete the request (\(code))."
        case .inconsistentRetry: return "This message identifier is already in use."
        case .expiredDraft: return "This unsent message is more than a day old. Copy its text and send it as a new message."
        case .invalidAttachments(let message): return message
        }
    }
}

/// HTTP adapter to the shared message API used by Macro's web channel UI.
@MainActor
final class MessagingAPI: MessagingService {
    typealias TokenProvider = @MainActor () async throws -> String

    private let baseURL: URL
    private let tokenProvider: TokenProvider
    private let invalidateToken: @MainActor () -> Void
    private let session: URLSession
    private let encoder = JSONEncoder()

    /// `baseURL` is the gateway origin; service prefixes are added by this adapter.
    init(baseURL: URL, tokenProvider: @escaping TokenProvider, invalidateToken: @escaping @MainActor () -> Void = {}, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.invalidateToken = invalidateToken
        self.session = session ?? MessagingTransport.session()
    }

    func channels(cursor: String? = nil) async throws -> ChannelPage {
        var query = [URLQueryItem(name: "limit", value: "100")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await request(path: "dss/comms/channels", query: query)
    }

    func messages(channelID: String, cursor: MessageCursor? = nil) async throws -> MessagePage {
        let selection = TimelineSelection(limit: 50, cursor: cursor, direction: cursor == nil ? nil : "older")
        let query = [URLQueryItem(name: "selection", value: String(decoding: try encoder.encode(selection), as: UTF8.self))]
        return try await request(path: messagePath(channelID), query: query)
    }

    func thread(channelID: String, rootID: String) async throws -> ChannelThread {
        try await request(path: "\(messagePath(channelID))/threads/\(rootID)")
    }

    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage {
        try await request(path: "\(messagePath(channelID))/items/\(messageID)")
    }

    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage {
        try await send(channelID: channelID, content: content, nonce: nonce, attachments: [])
    }

    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment]) async throws -> ChatMessage {
        try await send(channelID: channelID, content: content, nonce: nonce, attachments: attachments, threadID: nil)
    }

    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment], threadID: String?) async throws -> ChatMessage {
        guard attachments.count <= 10 else { throw MessagingError.invalidAttachments("A message can include up to 10 attachments.") }
        let references = try attachments.map(NewMessageAttachment.init)
        // UUID age is validated before the server checks conflicts. Resolve a very old
        // interrupted send by its stable id first; never mint a fresh id behind the UI.
        if let mintedAt = MessageID.date(nonce), Date().timeIntervalSince(mintedAt) > 86_400 {
            do {
                let persisted = try await getMessage(channelID: channelID, messageID: nonce)
                guard persisted.content == content, persisted.threadID == threadID,
                    try Self.sameReferences(persisted.attachments, references) else { throw MessagingError.inconsistentRetry }
                return persisted
            } catch MessagingError.http(404) { throw MessagingError.expiredDraft }
        }
        let body = try encoder.encode(PostMessage(id: nonce, content: content, nonce: nonce, mentions: MentionCodec.mentions(in: content), attachments: references, threadID: threadID))
        do {
            return try await request(path: messagePath(channelID), method: "POST", body: body)
        } catch MessagingError.http(409) {
            // The primary-key conflict confirms an earlier request committed. A nonce alone
            // is not idempotent: using the same UUIDv7 as the actual id prevents duplicates.
            let persisted = try await getMessage(channelID: channelID, messageID: nonce)
            guard persisted.content == content, persisted.threadID == threadID,
                try Self.sameReferences(persisted.attachments, references) else { throw MessagingError.inconsistentRetry }
            return persisted
        }
    }

    private static func sameReferences(_ persisted: [MessageAttachment], _ requested: [NewMessageAttachment]) throws -> Bool {
        // Attachment row IDs are allocated by the server; compare the complete
        // entity references as a multiset because database ordering may differ.
        let actual = try persisted.map(NewMessageAttachment.init)
        return actual.reduce(into: [:]) { $0[$1, default: 0] += 1 }
            == requested.reduce(into: [:]) { $0[$1, default: 0] += 1 }
    }

    func userNames(userIDs: [String]) async throws -> [String: String] {
        let ids = Array(Set(userIDs.filter { $0.hasPrefix("macro|") }))
        guard !ids.isEmpty else { return [:] }
        var names: [String: String] = [:]
        for start in stride(from: 0, to: ids.count, by: 100) {
            let batch = Array(ids[start..<min(start + 100, ids.count)])
            let response: UserNamesResponse = try await request(
                path: "auth/user/get_names", method: "POST", body: encoder.encode(UserNamesRequest(userIDs: batch))
            )
            for user in response.names {
                let name = [user.firstName, user.lastName].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { names[user.id] = name }
            }
        }
        return names
    }

    func userPhotos(userIDs: [String]) async throws -> [String: URL] {
        let ids = Array(Set(userIDs.filter { $0.hasPrefix("macro|") }))
        var photos: [String: URL] = [:]
        for start in stride(from: 0, to: ids.count, by: 100) {
            let batch = Array(ids[start..<min(start + 100, ids.count)])
            let response: ProfilePicturesResponse = try await request(path: "auth/user/profile_pictures", method: "POST", body: encoder.encode(ProfilePicturesRequest(user_id_list: batch)))
            for photo in response.pictures { if let url = URL(string: photo.url), url.scheme == "https" { photos[photo.id] = url } }
        }
        return photos
    }

    private func messagePath(_ channelID: String) -> String { "dss/messages/channel/\(channelID)" }

    private func request<Response: Decodable & Sendable>(
        path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil
    ) async throws -> Response {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw MessagingError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        for attempt in 0...1 {
            request.setValue("Bearer \(try await tokenProvider())", forHTTPHeaderField: "Authorization")
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw MessagingError.invalidResponse }
            if http.statusCode == 401, attempt == 0 { invalidateToken(); continue }
            guard (200..<300).contains(http.statusCode) else { throw MessagingError.http(http.statusCode) }
            let decoded = try await Task.detached(priority: .userInitiated) {
                try JSONDecoder().decode(Response.self, from: data)
            }.value
            try Task.checkCancellation()
            return decoded
        }
        throw MessagingError.http(401)
    }
}

private struct TimelineSelection: Encodable {
    var limit: Int
    var cursor: MessageCursor?
    var direction: String?
}

private struct PostMessage: Encodable {
    var id: String
    var content: String
    var nonce: String
    var mentions: [MessageMention] = []
    var attachments: [NewMessageAttachment] = []
    var threadID: String? = nil
    enum CodingKeys: String, CodingKey { case id, content, nonce, mentions, attachments; case threadID = "thread_id" }
}

struct NewMessageAttachment: Encodable, Hashable {
    let entityID: String
    let entityType: String
    let width: Int32?
    let height: Int32?
    enum CodingKeys: String, CodingKey { case entityID = "entity_id", entityType = "entity_type", width, height }

    init(_ attachment: MessageAttachment) throws {
        entityID = attachment.entityID; entityType = attachment.entityType
        width = try Self.dimension(attachment.width); height = try Self.dimension(attachment.height)
    }
    private static func dimension(_ value: Double?) throws -> Int32? {
        guard let value else { return nil }
        guard value.isFinite, value > 0, value.rounded() == value, value <= Double(Int32.max) else {
            throw MessagingError.invalidAttachments("This attachment has invalid image dimensions.")
        }
        return Int32(value)
    }
}

private struct UserNamesRequest: Encodable {
    var userIDs: [String]
    enum CodingKeys: String, CodingKey { case userIDs = "user_ids" }
}
private struct UserNamesResponse: Decodable, Sendable { var names: [UserNameRecord] }
private struct UserNameRecord: Decodable, Sendable {
    var id: String
    var firstName: String?
    var lastName: String?
    enum CodingKeys: String, CodingKey { case id; case firstName = "first_name", lastName = "last_name" }
}

private enum MessagingTransport {
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        return URLSession(configuration: configuration)
    }
}

@MainActor
protocol MessagingRealtimeService {
    func start(channelID: String?, onEvent: @escaping (MessageEvent) -> Void, onStatus: @escaping (SocketStatus) -> Void)
    func selectChannel(_ channelID: String?)
    func stop()
}

/// One foreground socket, with entity presence replayed after every reconnect.
@MainActor
final class MessagingSocket: MessagingRealtimeService {
    private let baseURL: URL
    private let tokenProvider: MessagingAPI.TokenProvider
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var connectionTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var trackingTask: Task<Void, Never>?
    private var selectedChannelID: String?
    private var trackedChannelID: String?
    private var generation = UUID()
    private var lastPong = Date()
    private var onEvent: ((MessageEvent) -> Void)?
    private var onStatus: ((SocketStatus) -> Void)?

    init(baseURL: URL, tokenProvider: @escaping MessagingAPI.TokenProvider, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.session = session ?? MessagingTransport.session()
    }

    func start(channelID: String?, onEvent: @escaping (MessageEvent) -> Void, onStatus: @escaping (SocketStatus) -> Void) {
        stop()
        selectedChannelID = channelID
        self.onEvent = onEvent
        self.onStatus = onStatus
        let current = generation
        connectionTask = Task { [weak self] in
            guard let self else { return }
            var attempt = 0
            while !Task.isCancelled && generation == current {
                onStatus(attempt == 0 ? .connecting : .reconnecting)
                do {
                    let token = try await tokenProvider()
                    guard !Task.isCancelled, generation == current else { return }
                    var components = URLComponents(url: baseURL.appendingPathComponent("connection-gateway"), resolvingAgainstBaseURL: false)!
                    components.scheme = baseURL.scheme == "http" ? "ws" : "wss"
                    components.queryItems = [URLQueryItem(name: "macro-api-token", value: token)]
                    guard let url = components.url else { throw MessagingError.invalidResponse }
                    let active = session.webSocketTask(with: url)
                    socket = active
                    active.resume()
                    try await active.send(.string("ping"))
                    guard generation == current, !Task.isCancelled else { active.cancel(); return }
                    lastPong = Date()
                    let connectedAt = Date()
                    trackedChannelID = nil
                    reconcileTracking(using: active)
                    onStatus(.connected)
                    startHeartbeat(socket: active, generation: current)
                    while !Task.isCancelled && generation == current {
                        let frame = try await active.receive()
                        guard generation == current else { return }
                        let data: Data
                        switch frame {
                        case .string(let value):
                            if value == "pong" {
                                lastPong = Date()
                                // A socket that immediately closes must not continually reset backoff.
                                if Date().timeIntervalSince(connectedAt) >= 30 { attempt = 0 }
                                continue
                            }
                            data = Data(value.utf8)
                        case .data(let value): data = value
                        @unknown default: continue
                        }
                        let event = try? await Task.detached(priority: .userInitiated) { try Self.decodeEvent(data) }.value
                        guard generation == current, !Task.isCancelled else { return }
                        if let event { onEvent(event) }
                    }
                } catch {
                    guard !Task.isCancelled, generation == current else { return }
                    // URLSession errors may contain the credential-bearing socket URL; never log them.
                }
                guard generation == current, !Task.isCancelled else { return }
                heartbeatTask?.cancel()
                trackingTask?.cancel()
                socket?.cancel(with: .goingAway, reason: nil)
                socket = nil
                trackedChannelID = nil
                attempt += 1
                onStatus(.reconnecting)
                let delay = min(30.0, pow(2.0, Double(min(attempt - 1, 5))))
                try? await Task.sleep(for: .seconds(delay))
            }
        }
    }

    func selectChannel(_ channelID: String?) {
        guard selectedChannelID != channelID else { return }
        selectedChannelID = channelID
        guard let socket else { return }
        reconcileTracking(using: socket)
    }

    private func reconcileTracking(using active: URLSessionWebSocketTask) {
        let current = generation
        let previousTask = trackingTask
        trackingTask = Task { [weak self] in
            // Serialize close/open writes. Fast A → B → C navigation must not leave B open
            // because its suspended send completed after C had already closed it.
            await previousTask?.value
            guard let self, current == generation, socket === active, !Task.isCancelled else { return }
            do {
                while trackedChannelID != selectedChannelID {
                    if let previous = trackedChannelID {
                        try await track(previous, action: "close", using: active)
                        guard current == generation, socket === active, !Task.isCancelled else { return }
                        trackedChannelID = nil
                    }
                    if let desired = selectedChannelID {
                        try await track(desired, action: "open", using: active)
                        guard current == generation, socket === active, !Task.isCancelled else { return }
                        trackedChannelID = desired
                    }
                }
            } catch {
                if current == generation, socket === active { active.cancel(with: .goingAway, reason: nil) }
            }
        }
    }

    func stop() {
        generation = UUID()
        connectionTask?.cancel()
        heartbeatTask?.cancel()
        trackingTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        connectionTask = nil
        heartbeatTask = nil
        trackingTask = nil
        socket = nil
        trackedChannelID = nil
        onStatus?(.disconnected)
        onEvent = nil
        onStatus = nil
    }

    private func startHeartbeat(socket: URLSessionWebSocketTask, generation current: UUID) {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            var ticks = 0
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                guard let self, generation == current else { return }
                guard Date().timeIntervalSince(lastPong) < 20 else {
                    socket.cancel(with: .goingAway, reason: nil)
                    return
                }
                do {
                    try await socket.send(.string("ping"))
                    ticks += 1
                    if ticks % 4 == 0, let channel = trackedChannelID {
                        try await track(channel, action: "ping", using: socket)
                    }
                } catch {
                    socket.cancel(with: .goingAway, reason: nil)
                    return
                }
            }
        }
    }

    private func track(_ channelID: String, action: String, using socket: URLSessionWebSocketTask) async throws {
        let body = ["type": "track_entity", "entity_type": "channel", "entity_id": channelID, "action": action]
        let data = try JSONEncoder().encode(body)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    /// Gateway `data` is a JSON-encoded string, unlike REST bodies. Older gateways may send an object.
    nonisolated static func decodeEvent(_ data: Data) throws -> MessageEvent? {
        guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = envelope["type"] as? String,
              let payload = envelope["data"] else { return nil }
        let payloadData: Data
        if let string = payload as? String { payloadData = Data(string.utf8) }
        else { payloadData = try JSONSerialization.data(withJSONObject: payload) }
        if type == "message_update" { return try JSONDecoder().decode(MessageEvent.self, from: payloadData) }
        if type == "comms_message" { return try decodeLegacyMessage(payloadData) }
        return nil
    }

    nonisolated static func decodeCognitionStream(_ data: Data) throws -> WorkspaceJSON? {
        let envelope = try JSONDecoder().decode(WorkspaceJSON.self, from: data)
        guard envelope["type"].string == "stream" else { return nil }
        let payload = envelope["data"]
        let item = try payload.string.map { try JSONDecoder().decode(WorkspaceJSON.self, from: Data($0.utf8)) } ?? payload
        return item["id"]["entity_type"].string == "chat" ? item : nil
    }

    nonisolated private static func decodeLegacyMessage(_ data: Data) throws -> MessageEvent? {
        guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let channelID = object["channel_id"] as? String else { return nil }
        object["parent"] = ["type": "channel", "id": channelID]
        object["isPartial"] = true
        for key in ["attachments", "reactions", "mentions"] where object[key] == nil { object[key] = [] }
        let message = try JSONDecoder().decode(ChatMessage.self, from: JSONSerialization.data(withJSONObject: object))
        let kind = message.deletedAt != nil ? "message_deleted" : message.editedAt != nil ? "edited" : "posted"
        return MessageEvent(parent: message.parent, actor: message.senderID, nonce: message.nonce, change: MessageChange(type: kind, message: message))
    }
}

private struct ProfilePicturesRequest: Encodable { var user_id_list: [String] }
private struct ProfilePicturesResponse: Decodable, Sendable { var pictures: [ProfilePicture] }
private struct ProfilePicture: Decodable, Sendable { var id: String; var url: String }
