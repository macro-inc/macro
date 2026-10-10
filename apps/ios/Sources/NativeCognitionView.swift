import SwiftUI

struct NativeCognitionDockPreference: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

struct NativeCognitionDestination: View {
    @Bindable var model: NativeCognitionStore
    let store: ChatStore
    let session: NativeSession
    var isNew = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.nativeChromeBottom) private var chromeBottom
    @State private var inputHeight: CGFloat = 44
    @State private var showAttachments = false
    @State private var showInfo = false
    @State private var nearBottom = true
    @State private var composerSize: CGFloat = 112
    @State private var focusRequest = 0
    @State private var dictation = NativeAgentDictation()
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }
    private var prefix: String { isNew ? "agent-new" : "cognition" }
    private var providerIcon: String { model.model.hasPrefix("openai/") ? "openai" : "claude" }

    var body: some View {
        GeometryReader { viewport in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        if model.isLoading && model.messages.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(20) }
                        ForEach(model.messages) { message in messageRow(message) }
                        if model.isStreaming { ProgressView().controlSize(.small).accessibilityLabel("Generating response") }
                        Color.clear.frame(height: 1).id("cognition-bottom")
                            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("cognition-scroll")).maxY } action: { nearBottom = $0 < viewport.size.height - composerSize - chromeBottom + 80 }
                    }.padding(.horizontal, 24).padding(.top, 64).padding(.bottom, composerSize + chromeBottom + 12)
                }.coordinateSpace(name: "cognition-scroll").scrollDismissesKeyboard(.interactively)
                    .accessibilityIdentifier("cognition-timeline")
                    .onChange(of: model.revision) { _, _ in if nearBottom { proxy.scrollTo("cognition-bottom", anchor: .bottom) } }
                    .onChange(of: model.isSending) { _, value in if value { nearBottom = true; proxy.scrollTo("cognition-bottom", anchor: .bottom) } }
                    .onChange(of: inputHeight) { _, _ in if nearBottom { proxy.scrollTo("cognition-bottom", anchor: .bottom) } }
            }
        }
        .overlay(alignment: .top) { header }
        .overlay(alignment: .bottom) {
            composer.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { composerSize = $0 }
                .padding(.bottom, chromeBottom)
        }
        .background(MacroTheme.background).toolbar(.hidden, for: .navigationBar)
        .preference(key: NativeCognitionDockPreference.self, value: true)
        .task { await model.start() }
        .onDisappear { model.stopObserving(); dictation.stop() }
        .onChange(of: scenePhase) { _, value in if value == .active { Task { await model.start() } } else { model.stopObserving() } }
        .sheet(isPresented: $showAttachments, onDismiss: { focusRequest += 1 }) {
            NativeAgentAttachmentPicker(session: session) { item in if model.attachments.count < 10 && !model.attachments.contains(where: { $0.id == item.id }) { model.attachments.append(item) } }
        }
        .fullScreenCover(isPresented: $showInfo) {
            NativeFloatingDrawer(onDismiss: { showInfo = false }, handleBottomPadding: 4) {
                HStack {
                    Text("Conversation").font(.system(size: 18 * rem, weight: .semibold))
                    Spacer()
                    Button { showInfo = false } label: {
                        MacroIcon(name: "x", size: 20 * rem).frame(width: 44 * rem, height: 44 * rem)
                            .background(.primary.opacity(0.06), in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel("Close conversation info").accessibilityIdentifier("cognition-info-close")
                }.padding(.horizontal, 20 * rem).padding(.bottom, 12 * rem)
                NativeDrawerScrollView(reservedHeight: 60 * rem) {
                    VStack(spacing: 20 * rem) {
                        LabeledContent("Conversation", value: model.name)
                        LabeledContent("Model", value: NativeCognitionAPI.models.first(where: { $0.id == model.model })?.name ?? model.model)
                    }.font(.system(size: 14 * rem)).padding(.horizontal, 20 * rem).padding(.vertical, 12 * rem)
                }
            }.presentationBackground(.clear)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button { dismiss() } label: { MacroIcon(name: "caret-left", size: 24).frame(width: 46, height: 40 * rem).contentShape(Capsule()) }
                .nativeGlass().accessibilityLabel("Back").accessibilityIdentifier(prefix + "-back")
            Menu {
                Picker("Model", selection: $model.model) { ForEach(NativeCognitionAPI.models, id: \.id) { item in Text(item.name).tag(item.id) } }
            } label: {
                HStack(spacing: 8) { MacroIcon(name: providerIcon, size: 20 * rem); Text(model.name).font(.system(size: 16 * rem, weight: .semibold)).lineLimit(1); MacroIcon(name: "caret-down", size: 16 * rem) }
                    .padding(.horizontal, 12 * rem).frame(height: 40 * rem).contentShape(Capsule())
            }.nativeGlass().accessibilityIdentifier(prefix + "-title").disabled(model.isSending || model.isStreaming)
            Spacer(minLength: 0)
            Button { showInfo = true } label: { MacroIcon(name: "info", size: 18 * rem).frame(width: 40 * rem, height: 40 * rem).contentShape(Circle()) }
                .nativeGlass().accessibilityLabel("Conversation info").accessibilityIdentifier("cognition-info")
        }.buttonStyle(.plain).foregroundStyle(.primary).padding(.horizontal, 12).padding(.top, 6)
    }
    @ViewBuilder private func messageRow(_ message: NativeCognitionMessage) -> some View {
        if message.role == "user" {
            VStack(alignment: .trailing, spacing: 4) {
                Text(MentionCodec.displayText(in: message.text)).font(.system(size: 15 * rem)).textSelection(.enabled).padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                if !message.attachments.isEmpty { Text("\(message.attachments.count) attachment\(message.attachments.count == 1 ? "" : "s")").font(.caption2).foregroundStyle(.secondary) }
                if message.id.hasPrefix("pending-") { Text(model.uncertainSubmission ? "Confirming delivery…" : "Sending…").font(.caption2).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 28)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(message.parts.enumerated()), id: \.offset) { _, part in
                    if part["type"].string == "text" {
                        Text((try? AttributedString(markdown: MentionCodec.markdownForDisplay(in: part["text"].string ?? ""), options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(part["text"].string ?? ""))
                            .font(.system(size: 15 * rem)).lineSpacing(4).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    } else if part["type"].string == "thinking" {
                        DisclosureGroup("Thinking") { Text(part["thinking"].string ?? "").font(.system(size: 13 * rem)).textSelection(.enabled) }.font(.system(size: 13 * rem)).foregroundStyle(.secondary)
                    } else if ["toolCall", "mcpToolCall"].contains(part["type"].string ?? "") {
                        let callID = part["id"].string ?? ""
                        let response = message.parts.first { $0["id"].string == callID && ["toolCallResponseJson", "toolCallErr"].contains($0["type"].string ?? "") }
                        DisclosureGroup(part.firstString("display_name", "name") ?? "Tool") {
                            if let response { Text(response.firstString("description") ?? Self.jsonText(response["json"])).font(.system(size: 12, design: .monospaced)).textSelection(.enabled) }
                            else if !model.isStreaming && model.canEdit {
                                Text(Self.jsonText(part["json"])).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                                HStack { Button("Approve") { Task { await model.answer(messageID: message.id, callID: callID, accept: true) } }; Button("Reject") { Task { await model.answer(messageID: message.id, callID: callID, accept: false) } } }
                            } else { Text("Working…").font(.caption) }
                        }.font(.system(size: 13 * rem)).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let error = model.error ?? dictation.error {
                HStack(alignment: .top) { Text(error).font(.caption).foregroundStyle(.secondary); Spacer(); Button("Check") { Task { await model.refresh() } }.font(.caption) }.accessibilityIdentifier("cognition-error")
            }
            if model.canEdit {
                VStack(alignment: .leading, spacing: 0) {
                    ZStack(alignment: .topLeading) {
                        if model.draft.isEmpty { Text("Ask Macro anything").font(.system(size: 15 * rem)).foregroundStyle(.tertiary).padding(.leading, 9).padding(.top, 14).allowsHitTesting(false) }
                        NativeMentionEditor(wire: $model.draft, height: $inputHeight, channel: Channel(id: model.id ?? "new-chat", name: "Macro"), store: store, session: session, plain: true, includeGroups: false, accessibilityID: prefix + "-composer", compact: true, focusRequest: focusRequest)
                            .frame(height: max(44, min(180, inputHeight))).allowsHitTesting(!model.uncertainSubmission)
                    }
                    if !model.attachments.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) { HStack { ForEach(model.attachments) { file in
                            HStack { MacroIcon(name: "file", size: 13); Text(file.name).lineLimit(1); Button { model.attachments.removeAll { $0.id == file.id } } label: { MacroIcon(name: "x", size: 12) }.accessibilityLabel("Remove " + file.name) }.font(.caption).padding(6).background(.quaternary, in: Capsule())
                        } } }.accessibilityIdentifier(prefix + "-attachments")
                    }
                    HStack(spacing: 0) {
                        NativeAgentFooterButton(image: "paperclip", pointSize: 24, title: "Attach file", identifier: prefix + "-attach", enabled: !model.uncertainSubmission) { showAttachments = true }.frame(width: 44, height: 44)
                        Spacer()
                        NativeAgentFooterButton(image: "microphone", pointSize: 24, title: "Dictate prompt", identifier: prefix + "-dictate") {
                            if dictation.recording { dictation.stop() }
                            else if session.isDemo { dictation.error = "Dictation is available after signing in." }
                            else { let prefix = model.draft.isEmpty ? "" : model.draft + " "; Task { await dictation.start { model.draft = prefix + $0 } } }
                        }.frame(width: 44, height: 44)
                        if model.isStreaming {
                            NativeAgentFooterButton(image: "stop.fill", isSymbol: true, pointSize: 14, title: "Stop response", identifier: "cognition-stop", filled: true) { Task { await model.stop() } }.frame(width: 44, height: 44)
                        } else {
                            NativeAgentFooterButton(image: "arrow.up.circle.fill", isSymbol: true, pointSize: 38, title: "Send message", identifier: prefix + "-send", enabled: !model.isSending && !model.uncertainSubmission && (!model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !model.attachments.isEmpty)) {
                                dictation.stop(); Task { _ = await model.send(content: model.draft, attachments: model.attachments) }
                            }.frame(width: 44, height: 44)
                        }
                    }
                }.padding(6).modifier(NativeAgentComposerGlass())
            } else { Text("You have view access to this conversation.").font(.caption).foregroundStyle(.secondary) }
        }.padding(.horizontal, 12).padding(.vertical, 10)
    }
    private static func jsonText(_ json: WorkspaceJSON) -> String { (try? JSONEncoder().encode(json)).flatMap { String(data: $0, encoding: .utf8) } ?? "" }
}

struct NativeCognitionRoute: View {
    let session: NativeSession
    let store: ChatStore
    @State private var model: NativeCognitionStore
    init(session: NativeSession, store: ChatStore, id: String) {
        self.session = session; self.store = store; _model = State(initialValue: NativeCognitionStore(session: session, chat: store, id: id))
    }
    var body: some View { NativeCognitionDestination(model: model, store: store, session: session) }
}
