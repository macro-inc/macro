import SwiftUI

/// Production’s unified reply composer floats above the keyboard, independently of the timeline.
struct InlineThreadReply: View {
    let root: ChatMessage
    var editing: ChatMessage? = nil
    let channel: Channel
    let store: ChatStore
    let session: NativeSession
    let onClose: () -> Void
    @State private var saving = false
    @State private var saveError: String?
    @State private var height: CGFloat = 50
    @State private var expandedFromText = false
    @State private var focused = true
    @State private var showAttachments = false
    @State private var dictation = NativeAgentDictation()

    private var draftKey: String { editing.map { "edit:\(channel.id):\($0.id)" } ?? "thread:\(channel.id):\(root.id)" }
    private var quoteKey: String { ReplyTargetContent.draftKey(channelID: channel.id, rootID: root.id) }
    private var quoteWire: String { editing == nil ? store.drafts[quoteKey] ?? "" : "" }
    private var quote: ReplyTargetQuote? { ReplyTargetContent.parse(quoteWire).first }
    private var draft: Binding<String> { Binding(get: { store.drafts[draftKey] ?? "" }, set: { store.setDraft($0, channelID: draftKey) }) }
    private var selected: [ChannelDraftAttachment] { store.draftAttachments[draftKey] ?? [] }
    private var canSend: Bool { !saving && store.canCompose(in: channel) && (!draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !selected.isEmpty) }
    private var failed: ChatMessage? {
        (store.messages[channel.id]?.first(where: { $0.id == root.id })?.thread?.preview ?? [])
            .last(where: { store.pending[$0.id] == .failed })
    }

    private var expanded: Bool { focused || quote != nil || expandedFromText || !selected.isEmpty }
    private var flag: String { editing != nil ? "Editing message" : root.replyCount > 0 ? "Replying to thread" : "Replying to " + store.name(for: root.senderID) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(flag).font(.system(size: 12.75)).foregroundStyle(.secondary).padding(.leading, 13)
                Spacer()
                NativeAgentFooterButton(image: "x", pointSize: 20, title: editing == nil ? "Close thread reply" : "Cancel edit", identifier: "inline-thread-close") {
                    dictation.stop(); if editing != nil { store.setDraft("", channelID: draftKey) }; onClose()
                }.frame(width: 36, height: 32)
            }.padding(.bottom, 12).padding(.horizontal, 1)
                .background(Color(uiColor: MacroTheme.surface), in: UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16))
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16).stroke(Color.primary.opacity(0.07), lineWidth: 0.75))
                .padding(.bottom, -12)
            VStack(alignment: .leading, spacing: 0) {
                if let quote {
                    NativeReplyQuote(sender: quote.senderName(currentUserID: store.userID, names: store.names), text: quote.displayText)
                        .padding(.horizontal, 15).padding(.top, 14).padding(.bottom, 3)
                }
                if !selected.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(selected) { file in
                                HStack(spacing: 4) {
                                    MacroIcon(name: "file", size: 14)
                                    Text(file.title).lineLimit(1)
                                    Button { store.setDraftAttachments(selected.filter { $0.id != file.id }, channelID: draftKey) } label: { Image(systemName: "xmark.circle.fill") }
                                        .accessibilityLabel("Remove " + file.title)
                                }.font(.system(size: 11)).padding(7).background(.quaternary, in: Capsule())
                            }
                        }
                    }.padding(.horizontal, 12).padding(.top, 8)
                }
                // Keep the UITextView in one stable hierarchy when wrapping expands the toolbar.
                // Moving it between conditional branches resigns first responder; using measured
                // height to collapse again also oscillates as the available editor width changes.
                HStack(alignment: .center, spacing: 2) {
                    if !expanded { attachButton }
                    editor
                    if !expanded {
                        if canSend { sendButton } else { dictateButton }
                    }
                }.padding(.horizontal, expanded ? 6 : 7)
                if expanded {
                    HStack(spacing: 2) {
                        attachButton
                        NativeAgentFooterButton(image: "trash", pointSize: 22, title: editing == nil ? "Clear reply" : "Discard edit", identifier: "inline-thread-clear") {
                            store.setDraft("", channelID: draftKey); store.setDraftAttachments([], channelID: draftKey)
                            if editing == nil { store.setDraft("", channelID: quoteKey) } else { onClose() }
                        }.frame(width: 40, height: 40)
                        Spacer()
                        dictateButton
                        if canSend { sendButton }
                    }.padding(.horizontal, 8).padding(.bottom, 6)
                }
            }.modifier(InlineReplyGlass())
            if let error = saveError ?? dictation.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(8) }
        }.fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .contain).accessibilityIdentifier("unified-thread-composer")
            .sheet(isPresented: $showAttachments) {
                ChannelAttachmentPicker(session: session, alreadySelected: Set(selected.map { $0.attachment.entityID })) { attachment, title in
                    guard !selected.contains(where: { $0.attachment.entityID == attachment.entityID }) else { return }
                    store.setDraftAttachments(selected + [.init(attachment: attachment, title: title)], channelID: draftKey)
                }
            }
            .onAppear {
                if let editing, store.drafts[draftKey] == nil || draft.wrappedValue.isEmpty {
                    store.setDraft(editing.content, channelID: draftKey)
                    store.setDraftAttachments(editing.attachments.map { .init(attachment: $0, title: $0.entityID) }, channelID: draftKey)
                }
            }
            .onChange(of: height) { _, value in if value > 54 { expandedFromText = true } }
            .onDisappear { dictation.stop() }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if draft.wrappedValue.isEmpty {
                Text(editing == nil ? "Send a reply" : "Edit message").font(.system(size: 15.9375)).foregroundStyle(.secondary)
                    .padding(.top, 13).padding(.leading, 13).allowsHitTesting(false)
            }
            NativeMentionEditor(wire: draft, height: $height, channel: channel, store: store, session: session,
                                plain: true, accessibilityID: editing == nil ? "inline-thread-input" : "edit-message-input", autoFocus: true,
                                onFocusChange: { focused = $0 })
                .frame(height: max(46, height)).disabled(!store.canCompose(in: channel))
        }
    }
    private var attachButton: some View {
        NativeAgentFooterButton(image: "paperclip", pointSize: 23, title: "Attach file to reply", identifier: "inline-thread-attach",
                                enabled: selected.count < 10 && store.canCompose(in: channel)) {
            dictation.stop(); showAttachments = true
        }.frame(width: 36, height: 44)
    }
    private var dictateButton: some View {
        NativeAgentFooterButton(image: "microphone", pointSize: 22, title: dictation.recording ? "Stop dictation" : "Dictate reply",
                                identifier: "inline-thread-dictate", enabled: store.canCompose(in: channel), tint: dictation.recording ? .systemRed : .label) {
            toggleDictation()
        }.frame(width: 36, height: 44)
    }
    private var sendButton: some View {
        NativeReplySendButton(enabled: canSend, action: send).frame(width: 40, height: 44)
    }

    private func send() {
        guard canSend else { return }
        dictation.stop()
        if let editing {
            saving = true; saveError = nil
            Task {
                do {
                    let edited = try await ChatActions(session: session).edit(message: editing, content: draft.wrappedValue, attachments: selected.map(\.attachment))
                    store.receive(MessageEvent(parent: edited.parent, actor: edited.senderID, change: MessageChange(type: "message_updated", message: edited)))
                    store.setDraft("", channelID: draftKey); store.setDraftAttachments([], channelID: draftKey); onClose()
                } catch { saveError = error.localizedDescription }
                saving = false
            }
            return
        }
        let content = (quoteWire.isEmpty ? "" : quoteWire + "\n\n") + draft.wrappedValue
        if store.send(content, channelID: channel.id, attachments: selected.map(\.attachment), threadID: root.id) != nil {
            store.setDraft("", channelID: draftKey)
            store.setDraft("", channelID: quoteKey)
            store.setDraftAttachments([], channelID: draftKey)
            onClose()
        }
    }

    private func toggleDictation() {
        if dictation.recording { dictation.stop(); return }
        guard !session.isDemo else { dictation.error = "Dictation is available after signing in."; return }
        let prefix = draft.wrappedValue.isEmpty ? "" : draft.wrappedValue + " "
        Task { await dictation.start { draft.wrappedValue = prefix + $0 } }
    }
}

private struct InlineReplyGlass: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26, *) { content.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 23)) }
        else { content.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 23)).overlay(RoundedRectangle(cornerRadius: 23).stroke(.separator.opacity(0.4), lineWidth: 0.5)) }
    }
}

private struct NativeReplySendButton: UIViewRepresentable {
    let enabled: Bool
    let action: () -> Void
    func makeCoordinator() -> NativeAgentFooterButton.Coordinator { .init(action: action) }
    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.addTarget(context.coordinator, action: #selector(NativeAgentFooterButton.Coordinator.activate), for: .touchUpInside)
        button.accessibilityIdentifier = "inline-thread-send"; button.accessibilityLabel = "Send reply"
        return button
    }
    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.action = action
        let configuration = UIImage.SymbolConfiguration(pointSize: 33, weight: .regular)
            .applying(UIImage.SymbolConfiguration(paletteColors: [MacroTheme.surface, .label]))
        button.setImage(UIImage(systemName: "arrow.up.circle.fill", withConfiguration: configuration), for: .normal)
        button.isEnabled = enabled
    }
}
