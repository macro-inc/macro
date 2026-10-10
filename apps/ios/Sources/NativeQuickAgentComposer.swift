import SwiftUI

/// The mobile page accessory stays mounted while typing and routes only on Send.
struct NativeQuickAgentComposer: View {
    let session: NativeSession
    let store: ChatStore
    var externalFocusRequest = 0
    let onFocusChange: (Bool) -> Void
    let onCreated: (NativeCognitionStore) -> Void
    @State private var prompt: String
    @State private var attachments: [NativeAgentPromptAttachment]
    @State private var submissionID: String
    @State private var submitted: Bool
    @State private var cognition: NativeCognitionStore
    @State private var height: CGFloat = 44
    @State private var busy = false
    @State private var error: String?
    @State private var showsAttachments = false
    @State private var focusRequest = 0
    @State private var dictation = NativeAgentDictation()
    // The signed-in production account exposes dictation once its flags load.
    private let dictationEnabled = true

    init(session: NativeSession, store: ChatStore, externalFocusRequest: Int = 0, onFocusChange: @escaping (Bool) -> Void, onCreated: @escaping (NativeCognitionStore) -> Void) {
        self.session = session; self.store = store; self.onFocusChange = onFocusChange; self.onCreated = onCreated
        self.externalFocusRequest = externalFocusRequest
        _prompt = State(initialValue: store.drafts["agent-new"] ?? "")
        let pending = store.drafts["agent-new-id"].flatMap { UUID(uuidString: $0) == nil ? nil : $0 }
        _submissionID = State(initialValue: pending ?? MessageID.new())
        _submitted = State(initialValue: pending != nil)
        let saved = store.drafts["agent-new-attachments"]?.data(using: .utf8)
        _attachments = State(initialValue: saved.flatMap { try? JSONDecoder().decode([NativeAgentPromptAttachment].self, from: $0) } ?? [])
        _cognition = State(initialValue: NativeCognitionStore(session: session, chat: store, draftKey: "agent-new"))
    }

    private var canSend: Bool { !busy && (!prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty) }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let error = error ?? dictation.error {
                Text(error).font(.system(size: 12)).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.top, 10)
                    .accessibilityIdentifier("ask-ai-error")
            }
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(attachments) { item in
                            HStack(spacing: 4) {
                                MacroIcon(name: "file", size: 13); Text(item.name).lineLimit(1)
                                Button { attachments.removeAll { $0.id == item.id } } label: { MacroIcon(name: "x", size: 12) }
                                    .disabled(submitted).accessibilityLabel("Remove " + item.name)
                            }.font(.system(size: 12)).padding(7).background(.quaternary, in: Capsule())
                        }
                    }
                }.padding(.horizontal, 10).padding(.top, 7)
            }
            HStack(alignment: .bottom, spacing: 0) {
                Button { dictation.stop(); showsAttachments = true } label: {
                    MacroIcon(name: "paperclip", size: 22).frame(width: 42, height: 46).contentShape(Rectangle())
                }.disabled(submitted || attachments.count >= 10).accessibilityLabel("Attach files").accessibilityIdentifier("ask-ai-attach")
                ZStack(alignment: .bottomLeading) {
                    if prompt.isEmpty { Text("Ask AI…").font(.system(size: 15.9375)).foregroundStyle(.secondary).padding(.leading, 5).padding(.bottom, 14).allowsHitTesting(false) }
                    NativeMentionEditor(wire: $prompt, height: $height, channel: Channel(id: submissionID, name: "Macro"), store: store, session: session,
                        plain: true, includeGroups: false, accessibilityID: "ask-ai-input", compact: true, focusRequest: focusRequest, onFocusChange: onFocusChange)
                        .frame(height: height).allowsHitTesting(!submitted)
                }.frame(maxWidth: .infinity)
                if dictationEnabled { Button { toggleDictation() } label: {
                    MacroIcon(name: "microphone", size: 22).foregroundStyle(dictation.recording ? .red : .primary).frame(width: 36, height: 46).contentShape(Rectangle())
                }.disabled(submitted).accessibilityLabel(dictation.recording ? "Stop dictation" : "Dictate prompt").accessibilityIdentifier("ask-ai-dictate") }
                Button { Task { await send() } } label: {
                    Group { if busy { ProgressView() } else { MacroIcon(name: "arrow-up", size: 22) } }
                        .foregroundStyle(canSend ? MacroTheme.background : Color.secondary)
                        .frame(width: 32, height: 32).background(canSend ? Color.primary : Color.secondary.opacity(0.08), in: Circle())
                        .frame(width: 40, height: 46).contentShape(Rectangle())
                }.disabled(!canSend).accessibilityLabel(submitted ? "Retry sending to Macro" : "Send to Macro").accessibilityIdentifier("ask-ai-send")
            }.buttonStyle(.plain).padding(.trailing, 4)
    }.nativeQuickComposerGlass()
        .sheet(isPresented: $showsAttachments, onDismiss: { focusRequest += 1 }) {
            NativeAgentAttachmentPicker(session: session) { item in
                if attachments.count < 10 && !attachments.contains(where: { $0.id == item.id }) { attachments.append(item) }
            }
        }
        .onChange(of: prompt) { _, value in store.setDraft(value, channelID: "agent-new") }
        .onChange(of: attachments) { _, value in
            store.setDraft((try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "", channelID: "agent-new-attachments")
        }
        .onChange(of: externalFocusRequest) { _, _ in focusRequest += 1 }
        .onAppear { if externalFocusRequest > 0 { focusRequest += 1 } }
        .onDisappear { dictation.stop(); onFocusChange(false) }
    }

    private func toggleDictation() {
        if dictation.recording { dictation.stop() }
        else if session.isDemo { dictation.error = "Dictation is available after signing in." }
        else {
            let prefix = prompt.isEmpty ? "" : prompt + " "
            Task { await dictation.start { prompt = prefix + $0 } }
        }
    }
    private func send() async {
        guard canSend else { return }
        busy = true; submitted = true; error = nil; dictation.stop()
        store.setDraft(submissionID, channelID: "agent-new-id")
        defer { busy = false }
        await cognition.start()
        guard await cognition.send(content: prompt.trimmingCharacters(in: .whitespacesAndNewlines), attachments: attachments) else {
            error = cognition.error ?? "Your message could not be sent. Please try again."
            return
        }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        prompt = ""; attachments = []; store.setDraft("", channelID: "agent-new")
        store.setDraft("", channelID: "agent-new-attachments"); store.setDraft("", channelID: "agent-new-id")
        store.setDraft("", channelID: "agent-new-cognition-id")
        submitted = false; submissionID = MessageID.new()
        let created = cognition
        cognition = NativeCognitionStore(session: session, chat: store, draftKey: "agent-new")
        onCreated(created)
    }
}

private extension View {
    @ViewBuilder func nativeQuickComposerGlass() -> some View {
        if #available(iOS 26, *) { glassEffect(.regular, in: RoundedRectangle(cornerRadius: 24)) }
        else { background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24)) }
    }
}
