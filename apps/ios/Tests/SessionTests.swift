import XCTest
@testable import MacroNative

@MainActor
final class SessionTests: XCTestCase {
    func testEmailCodeUsesSelectedEnvironmentAndNormalizedAddress() async throws {
        let session = makeSession()
        let sent = try await session.sendCode(email: "  Person@Example.com  ")
        XCTAssertTrue(sent)
        XCTAssertEqual(session.email, "person@example.com")
        XCTAssertFalse(session.isAuthenticated)
        XCTAssertFalse(session.isBusy)
    }

    func testInvalidCodeLeavesSessionSignedOut() async throws {
        let session = makeSession()
        _ = try await session.sendCode(email: "person@example.com")
        do {
            try await session.verifyCode("123456")
            XCTFail("An invalid verification code must not sign in")
        } catch NativeSessionError.invalidCode {
            XCTAssertFalse(session.isAuthenticated)
            XCTAssertFalse(session.isBusy)
        }
    }

    func testAuthenticationNeverAttachesCredentialsToAnExternalHost() async {
        let session = makeSession()
        do {
            _ = try await session.authenticatedData(for: URLRequest(url: URL(string: "https://example.org/private")!))
            XCTFail("External hosts must be rejected")
        } catch NativeSessionError.unsafeURL {
            XCTAssertFalse(session.isAuthenticated)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTokenExpiryRejectsMalformedPayloads() {
        XCTAssertEqual(NativeSession.expiration(of: "not-a-token"), .distantPast)
        XCTAssertEqual(NativeSession.expiration(of: "a.eyJleHAiOiJub3QtYS1udW1iZXIifQ.c"), .distantPast)
        XCTAssertEqual(NativeSession.expiration(of: "a.eyJleHAiOjIwMDAwMDAwMDB9.c"), Date(timeIntervalSince1970: 2_000_000_000))
    }

    private func makeSession() -> NativeSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SessionTestProtocol.self]
        return NativeSession(environment: .development, transport: URLSession(configuration: configuration))
    }
}

private final class SessionTestProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "dev-gateway.macro.com")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let status: Int
        if url.path == "/auth/login/passwordless" {
            XCTAssertEqual(request.httpMethod, "POST")
            let body = requestBody()
            let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: String]
            XCTAssertEqual(payload?["email"], "person@example.com")
            XCTAssertEqual(payload?["redirect_uri"], "https://dev.macro.com/app")
            status = 200
        } else {
            XCTAssertEqual(url.path, "/auth/oauth/passwordless/123456")
            XCTAssertEqual(request.httpMethod, "GET")
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "email" })?.value, "person@example.com")
            XCTAssertEqual(query?.first(where: { $0.name == "disable_redirect" })?.value, "true")
            status = 401
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private func requestBody() -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
