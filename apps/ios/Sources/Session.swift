import AuthenticationServices
import Foundation
import Observation
import Security
import UIKit
import WebKit

enum MacroEnvironment: String, CaseIterable, Identifiable, Codable {
    case production
    case development

    var id: String { rawValue }
    var title: String { self == .production ? "Macro" : "Development" }
    var gatewayURL: URL {
        URL(string: self == .production ? "https://gateway.macro.com" : "https://dev-gateway.macro.com")!
    }
    var webURL: URL {
        URL(string: self == .production ? "https://macro.com/app" : "https://dev.macro.com/app")!
    }
    var connectionURL: URL {
        URL(string: self == .production ? "wss://gateway.macro.com/connection-gateway" : "wss://dev-gateway.macro.com/connection-gateway")!
    }
    var cookiePrefix: String { self == .production ? "" : "dev-" }
}

enum NativeSessionError: LocalizedError {
    case signedOut
    case invalidEmail
    case invalidCode
    case requestFailed(Int)
    case invalidResponse
    case keychain(OSStatus)
    case canceled
    case unsafeURL

    var errorDescription: String? {
        switch self {
        case .signedOut: "Please sign in to continue."
        case .invalidEmail: "Enter a valid email address."
        case .invalidCode: "That code is invalid or expired. Check your email or request a new code."
        case .requestFailed(let status):
            status == 429 ? "Too many attempts. Please wait a moment and try again." : "Macro could not complete the request (\(status)). Please try again."
        case .invalidResponse: "Macro returned an unexpected response. Please try again."
        case .keychain: "Your sign-in could not be saved securely. Please try again."
        case .canceled: "Sign-in was canceled."
        case .unsafeURL: "This link cannot be opened inside your workspace."
        }
    }
}

private struct SessionTokens: Codable, Equatable {
    let access_token: String
    let refresh_token: String
}

private struct SavedSession: Codable {
    var tokens: SessionTokens
    var userID: String?
    var displayName: String?
    var email: String
}

@MainActor @Observable
final class NativeSession {
    private(set) var environment: MacroEnvironment
    private(set) var isAuthenticated = false
    private(set) var userID: String?
    private(set) var displayName: String?
    private(set) var email = ""
    private(set) var isBusy = false
    var errorMessage: String?
    private(set) var isDemo = false

    @ObservationIgnored let webDataStore = WKWebsiteDataStore.nonPersistent()
    @ObservationIgnored private let http: URLSession
    @ObservationIgnored private var tokens: SessionTokens?
    @ObservationIgnored private var apiToken: String?
    @ObservationIgnored private var refreshTask: Task<SessionTokens, Error>?
    @ObservationIgnored private var apiTokenTask: Task<String, Error>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var restored = false
    @ObservationIgnored private var browserAuthentication: BrowserAuthentication?

    init(environment: MacroEnvironment? = nil, transport: URLSession? = nil) {
        self.environment = environment
            ?? UserDefaults.standard.string(forKey: "native.environment").flatMap(MacroEnvironment.init(rawValue:))
            ?? .production
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        configuration.httpMaximumConnectionsPerHost = 8
        http = transport ?? URLSession(configuration: configuration)
    }

    #if DEBUG
    static func demo() -> NativeSession {
        let session = NativeSession(environment: .production)
        session.isDemo = true
        session.restored = true
        session.isAuthenticated = true
        session.userID = "macro|native-demo@macro.local"
        session.displayName = "Alex Morgan"
        session.email = "native-demo@macro.local"
        return session
    }
    #endif

    func restore() async {
        guard !restored else { return }
        restored = true
        do {
            guard let saved = try SessionKeychain.read(environment: environment) else { return }
            tokens = saved.tokens
            userID = saved.userID
            displayName = saved.displayName
            email = saved.email
            isAuthenticated = saved.userID != nil
            try await loadProfile()
        } catch {
            // A network outage must not destroy a valid saved session.
            errorMessage = error.localizedDescription
        }
    }

    func selectEnvironment(_ newEnvironment: MacroEnvironment) async {
        guard environment != newEnvironment else { return }
        clearMemory()
        await clearWebData()
        environment = newEnvironment
        UserDefaults.standard.set(newEnvironment.rawValue, forKey: "native.environment")
        restored = false
        await restore()
    }

    /// Returns true when a code was sent; false after a dedicated SSO provider completed sign-in.
    func sendCode(email proposedEmail: String) async throws -> Bool {
        let cleaned = proposedEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard cleaned.contains("@"), cleaned.split(separator: "@").count == 2,
              cleaned.split(separator: "@").last?.contains(".") == true else {
            throw NativeSessionError.invalidEmail
        }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        email = cleaned
        let currentGeneration = generation
        var request = request(path: "auth/login/passwordless", method: "POST")
        request.httpBody = try JSONEncoder().encode(["email": cleaned, "redirect_uri": environment.webURL.absoluteString])
        let (data, response) = try await perform(request)
        guard currentGeneration == generation else { throw CancellationError() }
        if response.statusCode == 202 {
            struct Provider: Decodable { let idp_id: String }
            let provider = try JSONDecoder().decode(Provider.self, from: data)
            try await authenticate(provider: provider.idp_id, emailHint: cleaned)
            return false
        }
        try validate(response)
        return true
    }

    func verifyCode(_ code: String) async throws {
        let cleaned = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, !email.isEmpty else { throw NativeSessionError.invalidCode }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        let currentGeneration = generation
        var request = request(path: "auth/oauth/passwordless")
        request.url = request.url?.appendingPathComponent(cleaned)
        guard let codeURL = request.url, var components = URLComponents(url: codeURL, resolvingAgainstBaseURL: false) else {
            throw NativeSessionError.invalidResponse
        }
        components.queryItems = [URLQueryItem(name: "email", value: email), URLQueryItem(name: "disable_redirect", value: "true")]
        request.url = components.url
        let (data, response) = try await perform(request)
        guard currentGeneration == generation else { throw CancellationError() }
        if response.statusCode == 400 || response.statusCode == 401 { throw NativeSessionError.invalidCode }
        try validate(response)
        try accept(try JSONDecoder().decode(SessionTokens.self, from: data))
        try await loadProfile()
    }

    func signInWithGoogle() async throws {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        try await authenticate(provider: nil, emailHint: nil)
    }

    func signOut() async {
        NativeTaskDraftCache.clear(session: self)
        let oldEnvironment = environment
        clearMemory()
        if !isDemo {
            do { try SessionKeychain.delete(environment: oldEnvironment) }
            catch { errorMessage = error.localizedDescription }
        }
        await clearWebData()
    }

    func accessToken() async throws -> String {
        guard let tokens else { throw NativeSessionError.signedOut }
        // The refresh endpoint returns the old JWT while it remains valid.
        if Self.expiration(of: tokens.access_token) > Date() { return tokens.access_token }
        return try await refreshTokens().access_token
    }

    func macroAPIToken() async throws -> String {
        guard !isDemo else { throw NativeSessionError.signedOut }
        if let apiToken, Self.expiration(of: apiToken) > Date().addingTimeInterval(30) { return apiToken }
        if let apiTokenTask { return try await apiTokenTask.value }
        let currentGeneration = generation
        let task = Task<String, Error> {
            let access = try await self.accessToken()
            var request = self.request(path: "auth/jwt/macro_api_token")
            request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
            var (data, response) = try await self.perform(request)
            if response.statusCode == 401 {
                let refreshed = try await self.refreshTokens()
                request.setValue("Bearer \(refreshed.access_token)", forHTTPHeaderField: "Authorization")
                (data, response) = try await self.perform(request)
            }
            try self.validate(response)
            struct APIResponse: Decodable { let macro_api_token: String }
            return try JSONDecoder().decode(APIResponse.self, from: data).macro_api_token
        }
        apiTokenTask = task
        defer { if generation == currentGeneration { apiTokenTask = nil } }
        let value = try await task.value
        guard generation == currentGeneration else { throw CancellationError() }
        apiToken = value
        return value
    }

    func invalidateAPIToken() { apiToken = nil }

    func authenticatedData(for input: URLRequest) async throws -> Data {
        guard input.url?.scheme == "https", input.url?.host == environment.gatewayURL.host else {
            throw NativeSessionError.unsafeURL
        }
        var request = input
        request.setValue("Bearer \(try await macroAPIToken())", forHTTPHeaderField: "Authorization")
        var (data, response) = try await perform(request)
        if response.statusCode == 401 {
            invalidateAPIToken()
            request.setValue("Bearer \(try await macroAPIToken())", forHTTPHeaderField: "Authorization")
            (data, response) = try await perform(request)
        }
        try validate(response)
        return data
    }

    func synchronizeWebCookies(to store: WKHTTPCookieStore) async throws {
        _ = try await accessToken()
        guard let tokens else { throw NativeSessionError.signedOut }
        for (name, value) in [("macro-access-token", tokens.access_token), ("macro-refresh-token", tokens.refresh_token)] {
            let properties: [HTTPCookiePropertyKey: Any] = [
                .name: environment.cookiePrefix + name, .value: value, .domain: ".macro.com", .path: "/",
                .secure: "TRUE", .expires: Date().addingTimeInterval(365 * 24 * 60 * 60),
                HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                HTTPCookiePropertyKey("SameSite"): environment == .production ? "Strict" : "None"
            ]
            guard let cookie = HTTPCookie(properties: properties) else { throw NativeSessionError.invalidResponse }
            await store.setCookie(cookie)
        }
    }

    func importWebCookies(from store: WKHTTPCookieStore) async {
        guard isAuthenticated, !isDemo else { return }
        let currentGeneration = generation
        let cookies = await store.allCookies()
        guard generation == currentGeneration,
              let access = cookies.first(where: { $0.name == environment.cookiePrefix + "macro-access-token" && ["macro.com", ".macro.com"].contains($0.domain) }),
              let refresh = cookies.first(where: { $0.name == environment.cookiePrefix + "macro-refresh-token" && ["macro.com", ".macro.com"].contains($0.domain) }),
              !access.value.isEmpty, !refresh.value.isEmpty else { return }
        let imported = SessionTokens(access_token: access.value, refresh_token: refresh.value)
        guard imported != tokens, Self.expiration(of: imported.access_token) > Date() else { return }
        do { try accept(imported) }
        catch { errorMessage = error.localizedDescription }
    }

    private func loadProfile() async throws {
        let currentGeneration = generation
        struct Profile: Decodable { let user_id: String }
        let data = try await authenticatedData(for: request(path: "auth/user/me"))
        let profile = try JSONDecoder().decode(Profile.self, from: data)
        guard generation == currentGeneration else { throw CancellationError() }
        userID = profile.user_id
        if profile.user_id.hasPrefix("macro|") { email = String(profile.user_id.dropFirst(6)) }
        struct Name: Decodable { let first_name: String?; let last_name: String? }
        if let data = try? await authenticatedData(for: request(path: "auth/user/name")),
           let name = try? JSONDecoder().decode(Name.self, from: data) {
            guard generation == currentGeneration else { throw CancellationError() }
            let fullName = [name.first_name, name.last_name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            displayName = fullName.isEmpty ? nil : fullName
        }
        guard generation == currentGeneration else { throw CancellationError() }
        try save()
        isAuthenticated = true
    }

    private func refreshTokens() async throws -> SessionTokens {
        if let refreshTask { return try await refreshTask.value }
        guard let tokens else { throw NativeSessionError.signedOut }
        let currentGeneration = generation
        let task = Task<SessionTokens, Error> {
            var request = self.request(path: "auth/jwt/refresh", method: "POST")
            request.setValue("Bearer \(tokens.access_token)", forHTTPHeaderField: "Authorization")
            request.setValue(tokens.refresh_token, forHTTPHeaderField: "x-macro-refresh-token")
            let (data, response) = try await self.perform(request)
            let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let rejected = response.statusCode == 401 || (response.statusCode == 400 && ["invalid refresh token", "no access token to refresh", "no refresh token to refresh"].contains(body ?? ""))
            if rejected {
                if self.generation == currentGeneration { await self.signOut() }
                throw NativeSessionError.signedOut
            }
            try self.validate(response)
            return try JSONDecoder().decode(SessionTokens.self, from: data)
        }
        refreshTask = task
        defer { if generation == currentGeneration { refreshTask = nil } }
        let refreshed = try await task.value
        guard generation == currentGeneration else { throw CancellationError() }
        try accept(refreshed)
        return refreshed
    }

    private func authenticate(provider: String?, emailHint: String?) async throws {
        let currentGeneration = generation
        let state = UUID().uuidString
        // The deployed backend accepts the existing macro scheme. The auth session
        // captures this callback itself; the app does not register or take over it.
        var callback = URLComponents(string: "macro://native-login")!
        callback.queryItems = [URLQueryItem(name: "state", value: state)]
        var components = URLComponents(url: environment.gatewayURL.appendingPathComponent("auth/login/sso"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "is_mobile", value: "true"),
            URLQueryItem(name: "original_url", value: callback.url!.absoluteString),
            URLQueryItem(name: provider == nil ? "idp_name" : "idp_id", value: provider ?? "google_gmail")
        ]
        if let emailHint { components.queryItems?.append(URLQueryItem(name: "login_hint", value: emailHint)) }
        let browser = BrowserAuthentication()
        browserAuthentication = browser
        defer { browserAuthentication = nil }
        let result = try await browser.authenticate(url: components.url!)
        guard generation == currentGeneration else { throw CancellationError() }
        let returned = URLComponents(url: result, resolvingAgainstBaseURL: false)
        guard result.scheme == "macro", result.host == "native-login",
              returned?.queryItems?.first(where: { $0.name == "state" })?.value == state,
              let code = returned?.queryItems?.first(where: { $0.name == "token" })?.value,
              !code.isEmpty else { throw NativeSessionError.invalidResponse }
        let (data, response) = try await perform(request(path: "auth/session/login").appendingPath(code))
        guard generation == currentGeneration else { throw CancellationError() }
        try validate(response)
        try accept(try JSONDecoder().decode(SessionTokens.self, from: data))
        try await loadProfile()
    }

    private func accept(_ newTokens: SessionTokens) throws {
        tokens = newTokens
        apiToken = nil
        try save()
    }

    /// Called only after the profile service accepts the user's edited name.
    func updateDisplayName(firstName: String, lastName: String) throws {
        let name = [firstName, lastName].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: " ")
        displayName = name.isEmpty ? nil : name
        try save()
    }

    private func save() throws {
        guard let tokens, !isDemo else { return }
        try SessionKeychain.write(SavedSession(tokens: tokens, userID: userID, displayName: displayName, email: email), environment: environment)
    }

    private func clearMemory() {
        generation += 1
        refreshTask?.cancel()
        apiTokenTask?.cancel()
        browserAuthentication?.cancel()
        refreshTask = nil
        apiTokenTask = nil
        apiToken = nil
        tokens = nil
        userID = nil
        displayName = nil
        email = ""
        errorMessage = nil
        isAuthenticated = false
    }

    private func clearWebData() async {
        await webDataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    }

    private func request(path: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: environment.gatewayURL.appendingPathComponent(path))
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard !isDemo else { throw NativeSessionError.signedOut }
        let (data, response) = try await http.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw NativeSessionError.invalidResponse }
        return (data, response)
    }

    private func validate(_ response: HTTPURLResponse) throws {
        guard (200..<300).contains(response.statusCode) else { throw NativeSessionError.requestFailed(response.statusCode) }
    }

    static func expiration(of token: String) -> Date {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return .distantPast }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
              let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let expiry = claims["exp"] as? Double else { return .distantPast }
        return Date(timeIntervalSince1970: expiry)
    }
}

private extension URLRequest {
    func appendingPath(_ path: String) -> URLRequest {
        var copy = self
        copy.url = url?.appendingPathComponent(path)
        return copy
    }
}

private enum SessionKeychain {
    private static func query(environment: MacroEnvironment) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.macro.app.native.session",
         kSecAttrAccount as String: environment.rawValue]
    }

    static func read(environment: MacroEnvironment) throws -> SavedSession? {
        var query = query(environment: environment)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw NativeSessionError.keychain(status) }
        return try JSONDecoder().decode(SavedSession.self, from: data)
    }

    static func write(_ session: SavedSession, environment: MacroEnvironment) throws {
        let data = try JSONEncoder().encode(session)
        let query = query(environment: environment)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let inserted = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard inserted == errSecSuccess else { throw NativeSessionError.keychain(inserted) }
        } else if status != errSecSuccess { throw NativeSessionError.keychain(status) }
    }

    static func delete(environment: MacroEnvironment) throws {
        let status = SecItemDelete(query(environment: environment) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeSessionError.keychain(status) }
    }
}

@MainActor
private final class BrowserAuthentication: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func authenticate(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            session = ASWebAuthenticationSession(url: url, callbackURLScheme: "macro") { url, error in
                if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: error ?? NativeSessionError.canceled) }
            }
            session?.presentationContextProvider = self
            session?.prefersEphemeralWebBrowserSession = true
            if session?.start() != true { continuation.resume(throwing: NativeSessionError.invalidResponse) }
        }
    }

    func cancel() { session?.cancel() }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
