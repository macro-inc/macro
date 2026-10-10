import Foundation

struct NativeChannelTeam: Decodable, Sendable {
    struct Team: Decodable, Sendable { let id: String; let name: String }
    struct Member: Decodable, Sendable { let userID: String; let role: String; enum CodingKeys: String, CodingKey { case userID = "user_id", role } }
    let team: Team
    let members: [Member]
}

/// Channel management uses the same endpoints as production's participant and compose flows.
@MainActor
final class ChannelManagementAPI {
    typealias Request = @MainActor (URLRequest) async throws -> Data
    private let baseURL: URL
    private let userID: String
    private let demo: Bool
    private let transport: Request
    convenience init(session: NativeSession) {
        self.init(baseURL: session.environment.gatewayURL, userID: session.userID ?? "", demo: session.isDemo) { try await session.authenticatedData(for: $0) }
    }
    init(baseURL: URL, userID: String, demo: Bool = false, request: @escaping Request) {
        self.baseURL = baseURL; self.userID = userID; self.demo = demo; transport = request
    }
    func participants(channel: Channel) async throws -> [ChannelParticipant] {
        if demo { return channel.participants }
        return try JSONDecoder().decode([ChannelParticipant].self, from: await request("dss/channels/\(channel.id)/participants"))
    }
    func invite(channelID: String, users: [String]) async throws {
        let ids = Array(Set(users.filter { $0 != userID })).sorted()
        guard !ids.isEmpty else { return }
        if demo { return }
        _ = try await request("dss/channels/\(channelID)/participants", method: "POST", body: ["participants": ids])
    }
    func remove(channelID: String, participant: ChannelParticipant) async throws {
        guard participant.userID != userID, participant.role != "owner" else { throw WorkspaceError.server("The channel owner and your own membership cannot be removed here.") }
        if demo { return }
        _ = try await request("dss/channels/\(channelID)/participants", method: "DELETE", body: ["participants": [participant.userID]])
    }
    func conversation(recipients: [String], name: String? = nil) async throws -> String {
        let ids = Array(Set(recipients.filter { $0 != userID })).sorted()
        guard !ids.isEmpty else { throw WorkspaceError.server("Add at least one recipient.") }
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty, ids.count > 1 {
            return try await create(name: name, recipients: ids)
        }
        if demo { return UUID().uuidString.lowercased() }
        struct Result: Decodable { let channel_id: String }
        let path = ids.count == 1 ? "get_or_create_dm" : "get_or_create_private"
        let body: [String: Any] = ids.count == 1 ? ["recipient_id": ids[0]] : ["recipients": ids]
        return try JSONDecoder().decode(Result.self, from: await request("dss/channels/\(path)", method: "POST", body: body)).channel_id
    }
    func create(name: String, recipients: [String], teamID: String? = nil, autoJoin: Bool = false) async throws -> String {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw WorkspaceError.server("Enter a channel name.") }
        if demo { return UUID().uuidString.lowercased() }
        struct Result: Decodable { let id: String }
        var ids = Array(Set(recipients.filter { $0 != userID })).sorted()
        // Team creation requires a nonempty participant list; the service deduplicates its creator.
        if teamID != nil && ids.isEmpty { ids = [userID] }
        var body: [String: Any] = ["name": name, "channel_type": teamID == nil ? "private" : "team", "participants": ids, "auto_join_team": teamID != nil && autoJoin]
        if let teamID { body["team_id"] = teamID }
        return try JSONDecoder().decode(Result.self, from: await request("dss/channels", method: "POST", body: body)).id
    }
    func currentTeam() async throws -> NativeChannelTeam? {
        if demo { return nil }
        let data = try await request("auth/team")
        if data.isEmpty || String(data: data, encoding: .utf8) == "null" { return nil }
        if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], object["team"] == nil { return nil }
        return try JSONDecoder().decode(NativeChannelTeam.self, from: data)
    }
    func inviteURL(channelID: String, webURL: URL) async throws -> URL {
        struct Result: Decodable { let join_code: String }
        let code = demo ? "fixture-invite" : try JSONDecoder().decode(Result.self, from: await request("dss/channels/\(channelID)/join-link")).join_code
        var url = URLComponents(url: webURL.appendingPathComponent("app/channel-invite"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "code", value: code)]
        guard let result = url.url else { throw WorkspaceError.invalidResponse }; return result
    }
    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path)); request.httpMethod = method; request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try await transport(request)
    }
    static func recipientID(_ value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "macro|", with: "")
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."), !value.contains(where: \.isWhitespace), !value.contains(where: { ",;<>".contains($0) }) else { return nil }
        return "macro|" + value
    }
}
