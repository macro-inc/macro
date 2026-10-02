import Foundation
import XCTest
@testable import MacroNative

@MainActor
final class MessagingContractTests: XCTestCase {
    private let channelID = "0197b2b0-1111-7000-8000-000000000001"
    private let messageID = "0197b2b0-2222-7000-8000-000000000002"

    private var messageJSON: String {
        """
        {"id":"\(messageID)","parent":{"type":"channel","id":"\(channelID)"},
         "sender_id":"macro|alice@example.com","content":"Hello **Macro**",
         "created_at":"2026-09-27T12:34:56.123456Z","updated_at":"2026-09-27T12:34:56.123456Z",
         "edited_at":null,"deleted_at":null,"thread_id":null,
         "attachments":[],"mentions":[],"reactions":[{"emoji":"👍","users":["macro|bob@example.com"]}]}
        """
    }

    func testChannelPagePreservesOpaquePaginationAndPreview() throws {
        let source = """
        {"items":[{"id":"\(channelID)","name":"Product","channel_type":"public",
          "participants":[{"user_id":"macro|alice@example.com","role":"owner"}],
          "latest_message":{"message_id":"\(messageID)","content":"Shipping today","sender_id":"macro|alice@example.com","created_at":"2026-09-27T12:34:56Z"},
          "updated_at":"2026-09-27T12:34:56Z","viewed_at":"2026-09-26T12:34:56Z","is_participant":true}],
         "next_cursor":"eyJrZXkiOiAidGVzdCJ9+/="}
        """
        let page = try JSONDecoder().decode(ChannelPage.self, from: Data(source.utf8))
        XCTAssertEqual(page.items.first?.preview, "Shipping today")
        XCTAssertEqual(page.items.first?.participants.first?.userID, "macro|alice@example.com")
        XCTAssertEqual(page.nextCursor, "eyJrZXkiOiAidGVzdCJ9+/=")
        XCTAssertEqual(page.items.first?.hasUnread, true)
    }

    func testSharedTimelineDecodesObjectCursorAndOptionalThreadMetadata() throws {
        let source = """
        {"items":[\(messageJSON)],"next_cursor":{"created_at":"2026-09-27T12:34:56.123456Z","id":"\(messageID)"},"previous_cursor":null}
        """
        let page = try JSONDecoder().decode(MessagePage.self, from: Data(source.utf8))
        XCTAssertEqual(page.items.first?.channelID, channelID)
        XCTAssertEqual(page.items.first?.reactions.first?.emoji, "👍")
        XCTAssertEqual(page.items.first?.replyCount, 0)
        XCTAssertEqual(page.nextCursor?.id, messageID)
        XCTAssertNotEqual(page.items.first?.date, .distantPast)
        let roundTrip = try JSONDecoder().decode(MessagePage.self, from: JSONEncoder().encode(page))
        XCTAssertEqual(roundTrip.nextCursor, page.nextCursor)
    }

    func testGatewayStringEnvelopeDecodesMessageAndNonce() throws {
        let event = """
        {"parent":{"type":"channel","id":"\(channelID)"},"actor":"macro|alice@example.com",
         "nonce":"optimistic-nonce","change":{"type":"posted","notification_policy":"Default","message":\(messageJSON),"mentions":[]}}
        """
        let envelope = try JSONSerialization.data(withJSONObject: ["type": "message_update", "data": event])
        let result = try MessagingSocket.decodeEvent(envelope)
        XCTAssertEqual(result?.change.type, "posted")
        XCTAssertEqual(result?.change.message?.id, messageID)
        XCTAssertEqual(result?.nonce, "optimistic-nonce")
    }

    func testGatewayObjectEnvelopeAndTypingAreAccepted() throws {
        let source = """
        {"type":"message_update","data":{"parent":{"type":"channel","id":"\(channelID)"},
         "actor":"macro|alice@example.com","change":{"type":"typing","active":true,"thread_id":null}}}
        """
        let event = try MessagingSocket.decodeEvent(Data(source.utf8))
        XCTAssertEqual(event?.change.active, true)
        XCTAssertNil(event?.change.message)
        XCTAssertNil(try MessagingSocket.decodeEvent(Data("{\"type\":\"other\",\"data\":{}}".utf8)))
        XCTAssertThrowsError(try MessagingSocket.decodeEvent(Data("{\"type\":\"message_update\",\"data\":\"invalid-json\"}".utf8)))
    }

    func testLegacyMessageHasCanonicalParent() throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(messageJSON.utf8)) as? [String: Any])
        object.removeValue(forKey: "parent")
        object.removeValue(forKey: "mentions")
        object["channel_id"] = channelID
        object["edited_at"] = "2026-09-27T12:35:00"
        let payload = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        let wire = try JSONSerialization.data(withJSONObject: ["type": "comms_message", "data": payload])
        let event = try MessagingSocket.decodeEvent(wire)
        XCTAssertEqual(event?.channelID, channelID)
        XCTAssertEqual(event?.change.type, "edited")
        XCTAssertEqual(event?.change.message?.mentions.count, 0)
        XCTAssertEqual(event?.change.message?.isPartial, true)
    }

    func testUUIDv7EmbedsMillisecondsAndRFCVariant() throws {
        let milliseconds: UInt64 = 1_800_000_000_123
        let id = MessageID.new(now: Date(timeIntervalSince1970: Double(milliseconds) / 1000))
        XCTAssertNotNil(UUID(uuidString: id))
        let compact = id.replacingOccurrences(of: "-", with: "")
        XCTAssertEqual(UInt64(compact.prefix(12), radix: 16), milliseconds)
        XCTAssertEqual(Array(compact)[12], "7")
        XCTAssertTrue(["8", "9", "a", "b"].contains(String(Array(compact)[16])))
        XCTAssertEqual(MessageID.date(id)?.timeIntervalSince1970 ?? 0, Double(milliseconds) / 1000, accuracy: 0.001)
        XCTAssertNil(MessageID.date(UUID().uuidString))
    }

    func testMessageRequestUsesSelectionCursorAndAPIToken() async throws {
        let channelID = channelID
        let messageID = messageID
        let source = Data("{\"items\":[],\"next_cursor\":null}".utf8)
        ContractURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/dss/messages/channel/\(channelID)")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
            let selection = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(selection.utf8)) as? [String: Any])
            XCTAssertEqual(object["direction"] as? String, "older")
            XCTAssertEqual((object["cursor"] as? [String: String])?["id"], messageID)
            return (200, source)
        }
        let api = makeAPI()
        let page = try await api.messages(channelID: channelID, cursor: MessageCursor(createdAt: "2026-09-27T12:34:56Z", id: messageID))
        XCTAssertTrue(page.items.isEmpty)
    }

    func testConflictingSendRecoversCommittedMessageWithoutAnotherPost() async throws {
        let freshID = MessageID.new()
        let data = Data(messageJSON.replacingOccurrences(of: messageID, with: freshID).utf8)
        var methods: [String] = []
        ContractURLProtocol.handler = { request in
            methods.append(request.httpMethod ?? "")
            if request.httpMethod == "POST" { return (409, Data()) }
            return (200, data)
        }
        let message = try await makeAPI().send(channelID: channelID, content: "Hello **Macro**", nonce: freshID)
        XCTAssertEqual(message.id, freshID)
        XCTAssertEqual(methods, ["POST", "GET"])
    }

    func testOldCommittedSendRecoversWithoutPostingInvalidUUID() async throws {
        let data = Data(messageJSON.utf8)
        var methods: [String] = []
        ContractURLProtocol.handler = { request in
            methods.append(request.httpMethod ?? "")
            return (200, data)
        }
        let message = try await makeAPI().send(channelID: channelID, content: "Hello **Macro**", nonce: messageID)
        XCTAssertEqual(message.id, messageID)
        XCTAssertEqual(methods, ["GET"])
    }

    func testOldUnsentMessageFailsClearlyWithoutChangingItsID() async throws {
        var methods: [String] = []
        ContractURLProtocol.handler = { request in
            methods.append(request.httpMethod ?? "")
            return (404, Data())
        }
        do {
            _ = try await makeAPI().send(channelID: channelID, content: "Hello **Macro**", nonce: messageID)
            XCTFail("Expected expired draft")
        } catch MessagingError.expiredDraft { }
        XCTAssertEqual(methods, ["GET"])
    }

    func testUnauthorizedRequestRefreshesTokenOnlyOnce() async throws {
        var attempts = 0
        var invalidations = 0
        ContractURLProtocol.handler = { _ in attempts += 1; return (401, Data()) }
        let api = makeAPI(invalidate: { invalidations += 1 })
        do {
            _ = try await api.channels()
            XCTFail("Expected unauthorized")
        } catch MessagingError.http(401) { }
        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(invalidations, 1)
    }

    func testSendIncludesAuthoredMentionReferencesAlongsideCanonicalContent() async throws {
        let freshID = MessageID.new()
        let content = """
        Hello <m-user-mention>{"userId":"macro|alice@example.com","displayName":"Alice"}</m-user-mention>
        See <m-document-mention>{"documentId":"\(channelID)","documentName":"Product","blockName":"channel"}</m-document-mention>
        <m-user-mention>{"userId":"macro|alice@example.com"}</m-user-mention>
        """
        var response = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(messageJSON.utf8)) as? [String: Any])
        response["id"] = freshID
        response["content"] = content
        let responseData = try JSONSerialization.data(withJSONObject: response)
        let channelID = channelID
        ContractURLProtocol.handler = { request in
            let data = try Self.requestBody(request)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(body["content"] as? String, content)
            XCTAssertEqual(body["id"] as? String, freshID)
            let mentions = try XCTUnwrap(body["mentions"] as? [[String: String]])
            XCTAssertEqual(mentions.count, 2)
            XCTAssertTrue(mentions.contains(["entity_type": "user", "entity_id": "macro|alice@example.com"]))
            XCTAssertTrue(mentions.contains(["entity_type": "channel", "entity_id": channelID]))
            return (200, responseData)
        }
        _ = try await makeAPI().send(channelID: channelID, content: content, nonce: freshID)
    }

    func testAttachmentOnlySendUsesNewAttachmentWireShapeWithoutOptimisticRowID() async throws {
        let freshID = MessageID.new()
        let attachment = MessageAttachment(id: "optimistic-row", entityID: "document-id", entityType: "document", width: 640, height: 480)
        var response = try JSONDecoder().decode(ChatMessage.self, from: Data(messageJSON.utf8))
        response.id = freshID; response.content = ""; response.attachments = [attachment]
        response.attachments[0].id = "server-row"
        let responseData = try JSONEncoder().encode(response)
        ContractURLProtocol.handler = { request in
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.requestBody(request)) as? [String: Any])
            XCTAssertEqual(body["content"] as? String, "")
            let actual = try XCTUnwrap((body["attachments"] as? [[String: Any]])?.first)
            XCTAssertEqual(Set(actual.keys), Set(["entity_id", "entity_type", "width", "height"]))
            XCTAssertEqual(actual["entity_id"] as? String, "document-id")
            XCTAssertEqual(actual["entity_type"] as? String, "document")
            XCTAssertEqual(actual["width"] as? Int, 640)
            XCTAssertNil(actual["id"])
            return (200, responseData)
        }
        let sent = try await makeAPI().send(channelID: channelID, content: "", nonce: freshID, attachments: [attachment])
        XCTAssertEqual(sent.attachments.first?.id, "server-row")
    }

    func testAttachmentRetryRecoveryComparesReferencesAndDimensionsRatherThanAllocatedRows() async throws {
        let attachment = MessageAttachment(id: "optimistic-row", entityID: "document-id", entityType: "document", width: 640, height: 480)
        for old in [false, true] {
            let id = old ? messageID : MessageID.new()
            for sameReference in [true, false] {
                var response = try JSONDecoder().decode(ChatMessage.self, from: Data(messageJSON.utf8))
                response.id = id; response.content = ""; response.attachments = [attachment]
                response.attachments[0].id = "server-row"
                if !sameReference { response.attachments[0].entityID = "different-document" }
                let data = try JSONEncoder().encode(response)
                var methods: [String] = []
                ContractURLProtocol.handler = { request in
                    methods.append(request.httpMethod ?? "")
                    return request.httpMethod == "POST" ? (409, Data()) : (200, data)
                }
                do {
                    _ = try await makeAPI().send(channelID: channelID, content: "", nonce: id, attachments: [attachment])
                    XCTAssertTrue(sameReference)
                } catch MessagingError.inconsistentRetry { XCTAssertFalse(sameReference) }
                XCTAssertEqual(methods, old ? ["GET"] : ["POST", "GET"])
            }
        }
    }

    nonisolated private static func requestBody(_ request: URLRequest) throws -> Data {
        if let data = request.httpBody { return data }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? MessagingError.invalidResponse }
            if count == 0 { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }

    private func makeAPI(invalidate: @escaping @MainActor () -> Void = {}) -> MessagingAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContractURLProtocol.self]
        return MessagingAPI(baseURL: URL(string: "https://gateway.example.test")!, tokenProvider: { "fixture-token" }, invalidateToken: invalidate, session: URLSession(configuration: configuration))
    }
}

private final class ContractURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
