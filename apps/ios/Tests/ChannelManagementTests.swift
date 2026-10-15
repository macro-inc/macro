import XCTest
@testable import MacroNative

@MainActor
final class ChannelManagementTests: XCTestCase {
    func testDirectAndGroupDraftsReuseCanonicalConversations() async throws {
        var requests: [URLRequest] = []
        let api = ChannelManagementAPI(baseURL: URL(string: "https://gateway.example.test")!, userID: "macro|me@example.com") { request in
            requests.append(request); return Data(#"{"channel_id":"existing-channel"}"#.utf8)
        }
        let direct = try await api.conversation(recipients: ["macro|other@example.com", "macro|other@example.com", "macro|me@example.com"])
        let group = try await api.conversation(recipients: ["macro|a@example.com", "macro|b@example.com"])
        XCTAssertEqual(direct, "existing-channel"); XCTAssertEqual(group, "existing-channel")
        XCTAssertEqual(requests.map { $0.url!.path }, ["/dss/channels/get_or_create_dm", "/dss/channels/get_or_create_private"])
        XCTAssertEqual(try body(requests[0])["recipient_id"] as? String, "macro|other@example.com")
        XCTAssertEqual(try body(requests[1])["recipients"] as? [String], ["macro|a@example.com", "macro|b@example.com"])
    }
    func testNamedGroupAndTeamCreateRetainProductionFields() async throws {
        var requests: [URLRequest] = []
        let api = ChannelManagementAPI(baseURL: URL(string: "https://gateway.example.test")!, userID: "macro|me@example.com") { request in
            requests.append(request); return Data(#"{"id":"new-channel"}"#.utf8)
        }
        _ = try await api.conversation(recipients: ["macro|a@example.com", "macro|b@example.com"], name: "  Planning  ")
        _ = try await api.create(name: "Engineering", recipients: [], teamID: "team-id", autoJoin: true)
        XCTAssertEqual(try body(requests[0])["channel_type"] as? String, "private")
        XCTAssertEqual(try body(requests[0])["name"] as? String, "Planning")
        XCTAssertEqual(try body(requests[1])["team_id"] as? String, "team-id")
        XCTAssertEqual(try body(requests[1])["auto_join_team"] as? Bool, true)
        XCTAssertEqual(try body(requests[1])["participants"] as? [String], ["macro|me@example.com"])
    }
    func testMembershipChangesGuardOwnerAndSelfAndDeduplicateInvites() async throws {
        var requests: [URLRequest] = []
        let api = ChannelManagementAPI(baseURL: URL(string: "https://gateway.example.test")!, userID: "self") { request in requests.append(request); return Data() }
        try await api.invite(channelID: "channel", users: ["self", "guest", "guest"])
        XCTAssertEqual(try body(requests[0])["participants"] as? [String], ["guest"])
        for person in [ChannelParticipant(userID: "self"), ChannelParticipant(userID: "owner", role: "owner")] {
            do { try await api.remove(channelID: "channel", participant: person); XCTFail("Protected membership must not issue a request") } catch { }
        }
        XCTAssertEqual(requests.count, 1)
        try await api.remove(channelID: "channel", participant: ChannelParticipant(userID: "guest"))
        XCTAssertEqual(requests[1].httpMethod, "DELETE")
    }
    func testJoinLinkUsesAuthorizedEndpointAndSafelyEncodesCode() async throws {
        var captured: URLRequest?
        let api = ChannelManagementAPI(baseURL: URL(string: "https://gateway.example.test")!, userID: "self") { request in captured = request; return Data(#"{"join_code":"a+/&=code"}"#.utf8) }
        let url = try await api.inviteURL(channelID: "channel", webURL: URL(string: "https://macro.example.test")!)
        XCTAssertEqual(captured?.httpMethod, "GET")
        XCTAssertEqual(captured?.url?.path, "/dss/channels/channel/join-link")
        XCTAssertEqual(url.path, "/app/channel-invite")
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "a+/&=code")
    }
    func testEmailRecipientsAreValidatedAndEmptyDraftCannotCreateChannel() async throws {
        XCTAssertEqual(ChannelManagementAPI.recipientID("  SOMEONE@Example.com  "), "macro|someone@example.com")
        for input in ["hello", "a@", "a@b", "a b@example.com", "a@example.com,b@example.com"] { XCTAssertNil(ChannelManagementAPI.recipientID(input)) }
        var requests = 0
        let api = ChannelManagementAPI(baseURL: URL(string: "https://gateway.example.test")!, userID: "self") { _ in requests += 1; return Data() }
        do { _ = try await api.conversation(recipients: ["self"]); XCTFail("Need a recipient") } catch { }
        do { _ = try await api.create(name: " \n ", recipients: []); XCTFail("Need a channel name") } catch { }
        XCTAssertEqual(requests, 0)
    }
    private func body(_ request: URLRequest) throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any]) }
}
