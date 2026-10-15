import SwiftUI

@main
struct MacroNativeApp: App {
    @State private var session: NativeSession
    @AppStorage("native-appearance") private var appearance = "system"

    init() {
        #if DEBUG
        _session = State(initialValue: ProcessInfo.processInfo.arguments.contains("--ui-testing") || ProcessInfo.processInfo.arguments.contains("--demo")
                         ? NativeSession.demo() : NativeSession())
        #else
        _session = State(initialValue: NativeSession())
        #endif
    }

    var body: some Scene {
        WindowGroup {
            AppRoot(session: session).tint(MacroTheme.accent)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
        }
    }
}

private struct AppRoot: View {
    let session: NativeSession
    @State private var store: ChatStore?
    @State private var restoring = true
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if let store, session.isAuthenticated {
                WorkspaceShell(session: session, store: store)
            } else if restoring {
                VStack(spacing: 20) {
                    MacroMark().frame(width: 60, height: 60)
                    ProgressView()
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                LoginView(session: session)
            }
        }
        .task {
            await session.restore()
            configureStore()
            restoring = false
        }
        .onChange(of: session.isAuthenticated) { _, authenticated in
            if authenticated { configureStore() }
            else {
                let previous = store; store = nil
                Task { await previous?.shutDown() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store?.resume() }
            else if phase == .background { store?.suspend() }
        }
    }

    private func configureStore() {
        guard store == nil, session.isAuthenticated, let userID = session.userID else { return }
        #if DEBUG
        if session.isDemo {
            let api = FixtureMessagingService()
            let demoStore = ChatStore(api: api, userID: userID)
            api.onMessage = { [weak demoStore] message in
                demoStore?.receive(MessageEvent(parent: message.parent, actor: message.senderID,
                    change: MessageChange(type: "message_created", message: message)))
            }
            store = demoStore
            return
        }
        #endif
        let api = MessagingAPI(baseURL: session.environment.gatewayURL,
                               tokenProvider: { try await session.macroAPIToken() },
                               invalidateToken: { session.invalidateAPIToken() })
        let socket = MessagingSocket(baseURL: session.environment.gatewayURL,
                                     tokenProvider: { try await session.macroAPIToken() })
        store = ChatStore(api: api, userID: userID, socket: socket,
                          cache: ChatDiskCache(account: session.environment.rawValue + ":" + userID))
    }
}

struct WorkspaceSheet: View {
    let session: NativeSession
    let url: URL
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            WebWorkspaceView(session: session, url: url)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}
