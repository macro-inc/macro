import SwiftUI

/// Production mobile Settings, contained in the shared floating glass drawer.
struct NativeSettingsView: View {
    let session: NativeSession
    let store: ChatStore
    @State private var profile: NativeSettingsProfile
    @AppStorage("native-appearance") private var appearance = "system"
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var rootSize: CGFloat = 17
    private var rem: CGFloat { rootSize / 16 }

    init(session: NativeSession, store: ChatStore) {
        self.session = session; self.store = store
        _profile = State(initialValue: NativeSettingsProfile(session: session))
    }

    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }, maximumHeightFraction: 0.94, handleBottomPadding: 4) {
            NativeSettingsDrawerBody {
                NavigationStack {
                    VStack(spacing: 0) {
                        HStack(spacing: 8 * rem) {
                            Color.clear.frame(width: 44, height: 44 * rem)
                            Text("Settings").font(.system(size: 18 * rem, weight: .semibold))
                                .frame(maxWidth: .infinity).accessibilityIdentifier("settings-heading")
                            Button { dismiss() } label: {
                                MacroIcon(name: "x", size: 20 * rem).frame(width: 44 * rem, height: 44 * rem)
                                    .background(.primary.opacity(0.06), in: Circle())
                            }.buttonStyle(.plain).accessibilityLabel("Close settings").accessibilityIdentifier("settings-close")
                        }.padding(.horizontal, 20 * rem).padding(.top, 4 * rem).padding(.bottom, 12 * rem)
                        ScrollView {
                            VStack(spacing: 0) {
                                NavigationLink {
                                    NativeProfileSettings(session: session, profile: profile).toolbar(.visible, for: .navigationBar)
                                } label: {
                                    VStack(spacing: 0) {
                                        AvatarView(name: profile.displayName, size: 80 * rem, photoURL: store.photos[session.userID ?? ""])
                                            .overlay(alignment: .bottomTrailing) {
                                                MacroIcon(name: "pencil-simple", size: 14 * rem).frame(width: 28 * rem, height: 28 * rem)
                                                    .background(MacroTheme.background, in: Circle()).overlay(Circle().stroke(.primary.opacity(0.08), lineWidth: 2))
                                                    .offset(x: 4 * rem, y: 4 * rem)
                                            }.padding(.bottom, 12 * rem)
                                        Text(profile.displayName).font(.system(size: 20 * rem, weight: .semibold)).lineLimit(1)
                                        Text(session.email).font(.system(size: 14 * rem)).foregroundStyle(.secondary).lineLimit(1).padding(.top, 4 * rem)
                                    }.frame(maxWidth: .infinity).padding(.horizontal, 16 * rem).padding(.top, 8 * rem).padding(.bottom, 12 * rem).contentShape(Rectangle())
                                }.buttonStyle(.plain).accessibilityIdentifier("settings-profile")
                                    .padding(.horizontal, 24 * rem).padding(.bottom, 28 * rem)
                                VStack(spacing: 24 * rem) {
                                    settingsGroup("Account") {
                                        NavigationLink { NativeProfileSettings(session: session, profile: profile).toolbar(.visible, for: .navigationBar) } label: { settingsRow("Account", icon: "user") }
                                        separator
                                        webRow("API Keys", icon: "key", slug: "api-keys")
                                        separator
                                        webRow("Billing", icon: "credit-card", slug: "billing")
                                    }
                                    settingsGroup("Preferences") {
                                        NavigationLink { NativeAppearanceSettings().toolbar(.visible, for: .navigationBar) } label: { settingsRow("Appearance", icon: "swatches") }
                                            .accessibilityIdentifier("settings-appearance")
                                    }
                                    settingsGroup("Workspace") {
                                        webRow("Team", icon: "users-three", slug: "team")
                                        separator
                                        webRow("Tags", icon: "tag-simple", slug: "tags")
                                        separator
                                        webRow("Integrations", icon: "cpu", slug: "connections")
                                    }
                                    Button(role: .destructive) { Task { await store.shutDown(); await session.signOut(); dismiss() } } label: {
                                        HStack(spacing: 14 * rem) {
                                            MacroIcon(name: "sign-out", size: 20 * rem); Text("Log out").font(.system(size: 15 * rem)); Spacer()
                                        }.padding(.horizontal, 14 * rem).frame(minHeight: 52 * rem).contentShape(Rectangle())
                                    }.buttonStyle(.plain).padding(4 * rem).background(.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 26))
                                        .accessibilityIdentifier("settings-logout")
                                }.padding(.horizontal, 12 * rem).padding(.bottom, 12 * rem)
                            }.padding(.bottom, 26)
                        }.scrollDismissesKeyboard(.interactively)
                    }.toolbar(.hidden, for: .navigationBar)
                        .background(Color.clear)
                        .task { await profile.load() }
                }.background(Color.clear)
            }
        }.preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
    }

    private var separator: some View {
        Rectangle().fill(.primary.opacity(0.06)).frame(height: 1).padding(.leading, 48 * rem).padding(.trailing, 12 * rem)
    }
    private func settingsGroup<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8 * rem) {
            Text(title).font(.system(size: 14 * rem, weight: .medium)).foregroundStyle(.secondary).padding(.horizontal, 16 * rem)
            VStack(spacing: 0, content: content).buttonStyle(.plain).padding(4 * rem)
                .background(.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 26))
        }
    }
    private func settingsRow(_ title: String, icon: String) -> some View {
        HStack(spacing: 14 * rem) {
            MacroIcon(name: icon, size: 20 * rem)
            Text(title).font(.system(size: 15 * rem)); Spacer()
            MacroIcon(name: "caret-right", size: 16 * rem).foregroundStyle(.tertiary)
        }.foregroundStyle(.primary).padding(.horizontal, 14 * rem).frame(minHeight: 52 * rem).contentShape(Rectangle())
    }
    private func webRow(_ title: String, icon: String, slug: String) -> some View {
        NavigationLink {
            WebWorkspaceView(session: session, url: session.environment.webURL.appendingPathComponent("settings/\(slug)"))
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
        } label: { settingsRow(title, icon: icon) }
            .accessibilityIdentifier("settings-\(slug)")
    }
}

private struct NativeSettingsDrawerBody<Content: View>: View {
    @Environment(\.nativeDrawerMaximumHeight) private var height
    @ViewBuilder let content: () -> Content
    var body: some View { content().frame(height: height) }
}

private struct NativeAppearanceSettings: View {
    @AppStorage("native-appearance") private var appearance = "system"
    var body: some View {
        List {
            Section("Mode") {
                ForEach([("system", "System", "circle.lefthalf.filled"), ("light", "Light", "sun.max"), ("dark", "Dark", "moon")], id: \.0) { value, title, symbol in
                    Button { appearance = value } label: {
                        HStack {
                            Label(title, systemImage: symbol).foregroundStyle(.primary)
                            Spacer()
                            if appearance == value { Image(systemName: "checkmark").foregroundStyle(MacroTheme.accent) }
                        }
                    }.buttonStyle(.plain).accessibilityIdentifier("appearance-\(value)").accessibilityAddTraits(appearance == value ? .isSelected : [])
                }
            }
        }.font(.system(size: 15)).navigationTitle("Appearance").navigationBarTitleDisplayMode(.inline)
    }
}

@MainActor @Observable
final class NativeSettingsProfile {
    var firstName = ""
    var lastName = ""
    var error: String?
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var savedName: String
    private let session: NativeSession
    private(set) var loaded = false
    var displayName: String { savedName.isEmpty ? session.email.components(separatedBy: "@").first ?? "Account" : savedName }

    init(session: NativeSession) { self.session = session; savedName = session.displayName ?? "" }
    func load() async {
        guard !loaded, !isLoading else { return }
        isLoading = true; error = nil
        defer { isLoading = false }
        if session.isDemo {
            firstName = "Alex"; lastName = "Morgan"; loaded = true; return
        }
        do {
            let data = try await session.authenticatedData(for: URLRequest(url: session.environment.gatewayURL.appendingPathComponent("auth/user/name")))
            apply(try JSONDecoder().decode(Name.self, from: data)); loaded = true
        } catch { self.error = error.localizedDescription }
    }
    func save() async -> Bool {
        guard !isSaving else { return false }
        isSaving = true; error = nil
        defer { isSaving = false }
        let first = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        let last = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
        if session.isDemo { apply(Name(first_name: first, last_name: last)); try? session.updateDisplayName(firstName: first, lastName: last); return true }
        do {
            var url = URLComponents(url: session.environment.gatewayURL.appendingPathComponent("auth/user/name"), resolvingAgainstBaseURL: false)!
            url.queryItems = [.init(name: "first_name", value: first), .init(name: "last_name", value: last)]
            var request = URLRequest(url: url.url!); request.httpMethod = "PUT"
            let data = try await session.authenticatedData(for: request)
            apply(try JSONDecoder().decode(Name.self, from: data))
            try session.updateDisplayName(firstName: firstName, lastName: lastName)
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private struct Name: Decodable { let first_name: String?; let last_name: String? }
    private func apply(_ name: Name) {
        firstName = name.first_name ?? ""; lastName = name.last_name ?? ""
        savedName = [firstName, lastName].filter { !$0.isEmpty }.joined(separator: " ")
    }
}

private struct NativeProfileSettings: View {
    let session: NativeSession
    @Bindable var profile: NativeSettingsProfile
    @State private var saved = false
    var body: some View {
        Form {
            Section("Profile") {
                TextField("First name", text: $profile.firstName).textContentType(.givenName).accessibilityIdentifier("profile-first-name")
                TextField("Last name", text: $profile.lastName).textContentType(.familyName).accessibilityIdentifier("profile-last-name")
                LabeledContent("Email", value: session.email).textSelection(.enabled)
            }.disabled(profile.isLoading || profile.isSaving)
            if profile.isLoading { ProgressView("Loading profile…") }
            if let error = profile.error {
                Section {
                    Text(error).foregroundStyle(.red)
                    Button(profile.loaded ? "Try saving again" : "Try again") {
                        Task {
                            if profile.loaded { saved = await profile.save() }
                            else { await profile.load() }
                        }
                    }
                }
            }
            Section {
                NavigationLink("Profile photo and account management") {
                    WebWorkspaceView(session: session, url: session.environment.webURL.appendingPathComponent("settings/account"))
                        .navigationTitle("Account")
                }
            }
        }.font(.system(size: 15))
            .navigationTitle("Account").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button(saved ? "Saved" : "Save") { Task { saved = await profile.save() } }
                    .disabled(!profile.loaded || profile.isLoading || profile.isSaving).accessibilityIdentifier("profile-save")
            } }
            .onChange(of: profile.firstName) { _, _ in saved = false }
            .onChange(of: profile.lastName) { _, _ in saved = false }
            .task { await profile.load() }
    }
}
