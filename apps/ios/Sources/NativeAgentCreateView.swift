import SwiftUI

/// Explicit Agents creation retains ACP; Ask Macro uses cognition chats instead.
struct NativeAgentCreateView: View {
    let session: NativeSession
    let store: ChatStore
    @State private var api: NativeAgentAPI
    @State private var prompt: String
    @State private var attachments: [NativeAgentPromptAttachment]
    @State private var id: String
    @State private var submitted: Bool
    @State private var item: WorkspaceItem?
    @State private var error: String?
    @State private var busy = false
    @State private var showFiles = false
    @State private var height: CGFloat = 44
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeChromeBottom) private var chromeBottom
    init(session: NativeSession, store: ChatStore) {
        self.session = session; self.store = store
        _api = State(initialValue: NativeAgentAPI(session: session))
        _prompt = State(initialValue: store.drafts["agent-create"] ?? "")
        _attachments = State(initialValue: store.drafts["agent-create-files"]?.data(using: .utf8).flatMap { try? JSONDecoder().decode([NativeAgentPromptAttachment].self, from: $0) } ?? [])
        let saved = store.drafts["agent-create-id"].flatMap { UUID(uuidString: $0) == nil ? nil : $0 }
        _id = State(initialValue: saved ?? MessageID.new()); _submitted = State(initialValue: saved != nil)
    }
    var body: some View {
        Group {
            if let item { NativeAgentDestination(session: session, item: item, store: store, api: api) }
            else {
                Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(alignment: .top) {
                        HStack(spacing: 8) {
                            Button { dismiss() } label: { MacroIcon(name: "caret-left", size: 24).frame(width: 46, height: 42.5) }.nativeGlass().accessibilityLabel("Back")
                            HStack(spacing: 8) { MacroIcon(name: "sparkle", size: 21.25); Text("New Agent").font(.system(size: 17, weight: .semibold)) }.padding(.horizontal, 12.75).frame(height: 42.5).nativeGlass()
                            Spacer()
                        }.buttonStyle(.plain).padding(.horizontal, 12).padding(.top, 6)
                    }
                    .overlay(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 8) {
                            if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
                            VStack(alignment: .leading, spacing: 0) {
                                ZStack(alignment: .topLeading) {
                                    if prompt.isEmpty { Text("Message Macro, @mention anything").font(.system(size: 15.9375)).foregroundStyle(.tertiary).padding(.leading, 9).padding(.top, 14).allowsHitTesting(false) }
                                    NativeMentionEditor(wire: $prompt, height: $height, channel: Channel(id: id, name: "Macro"), store: store, session: session, plain: true, includeGroups: false, accessibilityID: "agent-create-input", compact: true)
                                        .frame(height: height).allowsHitTesting(!submitted)
                                }
                                if !attachments.isEmpty { Text(attachments.map(\.name).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 10) }
                                HStack {
                                    HStack(spacing: 6) { MacroIcon(name: "macro-logo", size: 18); Text("Macro").font(.system(size: 13.8125)) }.padding(.leading, 8)
                                    NativeAgentFooterButton(image: "paperclip", title: "Attach file", identifier: "agent-create-attach", enabled: !submitted) { showFiles = true }.frame(width: 44, height: 44)
                                    Spacer()
                                    NativeAgentFooterButton(image: "arrow.up.circle.fill", isSymbol: true, pointSize: 38, title: submitted ? "Retry" : "Start agent", identifier: "agent-create-send", enabled: !busy && (!prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)) { Task { await create() } }.frame(width: 44, height: 44)
                                }
                            }.padding(6).modifier(NativeAgentComposerGlass())
                        }.padding(.horizontal, 12).padding(.bottom, chromeBottom + 10)
                    }
            }
        }.background(MacroTheme.background).toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showFiles) { NativeAgentAttachmentPicker(session: session) { if attachments.count < 10 { attachments.append($0) } } }
            .onChange(of: prompt) { _, value in if item == nil { store.setDraft(value, channelID: "agent-create") } }
            .onChange(of: attachments) { _, value in if item == nil { store.setDraft((try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "", channelID: "agent-create-files") } }
    }
    private func create() async {
        guard !busy else { return }; busy = true; submitted = true; error = nil
        store.setDraft(id, channelID: "agent-create-id"); defer { busy = false }
        do {
            let record = try await api.create(prompt: prompt, id: id, attachments: attachments)
            store.setDraft("", channelID: "agent-create"); store.setDraft("", channelID: "agent-create-files"); store.setDraft("", channelID: "agent-create-id")
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            item = WorkspaceItem(id: record.id, kind: .agent, title: record.name, entityType: "agent_session")
        } catch { self.error = error.localizedDescription }
    }
}
