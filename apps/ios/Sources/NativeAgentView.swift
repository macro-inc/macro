import SwiftUI

struct NativeAgentDestination: View {
    let session: NativeSession
    let item: WorkspaceItem
    let chat: ChatStore?
    @State private var model: NativeAgentStore
    @State private var nearBottom = true
    @State private var scrollRequest = 0
    @State private var showWebForm = false
    @State private var showInfo = false
    @State private var showAttachments = false
    @State private var showChanges = false
    @State private var dismissedChangesID: String?
    @State private var composerHeight: CGFloat = 60
    @State private var dictation = NativeAgentDictation()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeChromeBottom) private var nativeChromeBottom
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }

    init(session: NativeSession, item: WorkspaceItem, store: ChatStore? = nil, api: NativeAgentAPI? = nil) {
        self.session = session; self.item = item; self.chat = store
        _model = State(initialValue: NativeAgentStore(id: item.id, api: api ?? NativeAgentAPI(session: session), socket: NativeAgentSocket(session: session), draftStore: store))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if model.loading && model.transcript.parts.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(30) }
                    ForEach(displayGroups) { group in
                        if group.tools.isEmpty, let part = group.part { transcriptPart(part) }
                        else {
                            DisclosureGroup {
                                VStack(alignment: .leading, spacing: 12) { ForEach(group.tools) { transcriptPart($0) } }.padding(.top, 10)
                            } label: { Text("Called \(group.tools.count) tool\(group.tools.count == 1 ? "" : "s")").font(.system(size: 13)).foregroundStyle(Color(uiColor: .secondaryLabel)) }
                                .tint(Color(uiColor: .secondaryLabel))
                                .accessibilityIdentifier("agent-tool-group-" + group.id)
                        }
                    }
                    ForEach(model.queue) { action in
                        promptBubble(action.prompt ?? "Compact conversation", status: "Queued", id: action.id)
                    }
                    ForEach(model.pending) { action in
                        VStack(alignment: .trailing, spacing: 4) {
                            promptBubble(action.text, status: action.state, id: action.id)
                            if action.state == "Failed" && model.record?.canEdit == true {
                                Button("Retry") { model.retry(action) }.font(.caption).accessibilityIdentifier("agent-retry-\(action.id)")
                            }
                        }.frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    if model.transcript.isWorking {
                        HStack(spacing: 8) {
                            if !model.transcript.isWaiting { ProgressView().controlSize(.small) }
                            Text(model.transcript.isWaiting ? "Waiting for your response" : "Working…").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Color.clear.frame(height: 1).id("agent-bottom")
                        .onAppear { nearBottom = true }.onDisappear { nearBottom = false }
                }.padding(.horizontal, 24).padding(.vertical, 16)
            }
            .background(MacroTheme.background)
            .accessibilityIdentifier("agent-timeline")
            .contentMargins(.top, 52 * rem, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await model.refresh() }
            .onChange(of: model.displayRevision) { _, _ in
                if nearBottom { proxy.scrollTo("agent-bottom", anchor: .bottom) }
            }
            .onChange(of: scrollRequest) { _, _ in proxy.scrollTo("agent-bottom", anchor: .bottom) }
            .onChange(of: composerHeight) { _, _ in if nearBottom { proxy.scrollTo("agent-bottom", anchor: .bottom) } }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        }
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) { header }
        .sheet(isPresented: $showInfo) {
            NavigationStack {
                List {
                    LabeledContent("Agent", value: model.bot.name)
                    LabeledContent("Status", value: statusLabel)
                    if let record = model.record {
                        LabeledContent("Model", value: record.model)
                        if let repo = record.repository { LabeledContent("Repository", value: repo) }
                        if let url = pullRequestURL { Link("Open pull request", destination: url) }
                    }
                }.navigationTitle("Conversation").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showInfo = false } } }
            }
        }
        .task { await model.start() }
        .onDisappear { model.stopObserving(); dictation.stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.start() } }
            else { model.stopObserving() }
        }
        .sheet(isPresented: $showChanges) { NativeAgentChangesView(model: model) }
        .sheet(isPresented: $showAttachments) {
            NativeAgentAttachmentPicker(session: session) { model.draftAttachments.append($0) }
        }
        .sheet(isPresented: $showWebForm) {
            NavigationStack {
                WebWorkspaceView(session: session, url: session.environment.webURL.appendingPathComponent("agents/" + item.id))
            }
        }
    }

    private var statusLabel: String {
        model.transcript.isWaiting ? "Waiting" : model.transcript.isWorking ? "Working" : model.record?.status["kind"].string == "disconnected" ? "Disconnected" : "Ready"
    }

    private var pullRequestURL: URL? {
        guard let string = model.record?.pullRequestUrl, let url = URL(string: string), url.scheme == "https" else { return nil }
        return url
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button { dismiss() } label: {
                MacroIcon(name: "caret-left", size: 24).frame(width: 40 * rem, height: 40 * rem).contentShape(Circle())
            }.nativeGlass().accessibilityLabel("Back").accessibilityIdentifier("agent-back")
            Button { showInfo = true } label: {
                HStack(spacing: 6) {
                    Text(model.record?.name ?? item.title).font(.system(size: 14 * rem, weight: .semibold)).lineLimit(1)
                    MacroIcon(name: "caret-down", size: 16)
                }.padding(.horizontal, 12).frame(height: 40 * rem).contentShape(Capsule()).nativeGlass()
            }.accessibilityLabel("Agent title and actions").accessibilityIdentifier("agent-title")
            Spacer(minLength: 0)
            if let url = pullRequestURL {
                Link(destination: url) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.pull").font(.system(size: 12)).foregroundStyle(pullRequestColor)
                        Text("#" + url.lastPathComponent)
                        Text(pullRequestState.capitalized).foregroundStyle(pullRequestColor)
                    }.font(.system(size: 12)).foregroundStyle(.secondary).padding(.horizontal, 8).frame(height: 28 * rem)
                        .background(Color(uiColor: .secondarySystemBackground), in: Capsule()).overlay(Capsule().strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5))
                }
                    .accessibilityLabel("Pull request").accessibilityIdentifier("agent-pull-request")
                    .fixedSize()
            }
            Button { showInfo = true } label: { MacroIcon(name: "info", size: 16).frame(width: 40 * rem, height: 40 * rem).contentShape(Circle()) }
                .nativeGlass().accessibilityLabel("Agent information").accessibilityIdentifier("agent-info")
        }.buttonStyle(.plain).foregroundStyle(.primary).frame(height: 45 * rem).padding(.horizontal, 12)
            .background { LinearGradient(colors: [MacroTheme.background.opacity(0.92), MacroTheme.background.opacity(0)], startPoint: .top, endPoint: .bottom).padding(.bottom, -24).ignoresSafeArea(edges: .top).allowsHitTesting(false) }
    }
    private var pullRequestState: String { item.payload["pullRequestState"].string ?? "open" }
    private var pullRequestColor: Color { pullRequestState == "merged" ? .purple : pullRequestState == "closed" ? .red : .green }

    private struct DisplayGroup: Identifiable {
        var id: String
        var part: NativeAgentPart?
        var tools: [NativeAgentPart] = []
    }
    private var displayGroups: [DisplayGroup] {
        var groups: [DisplayGroup] = []
        for part in model.transcript.parts {
            if part.kind == .tool {
                if let last = groups.indices.last, !groups[last].tools.isEmpty { groups[last].tools.append(part) }
                else { groups.append(.init(id: part.id, tools: [part])) }
            } else { groups.append(.init(id: part.id, part: part)) }
        }
        return groups
    }

    @ViewBuilder private func transcriptPart(_ part: NativeAgentPart) -> some View {
        Group {
            switch part.kind {
            case .user:
                VStack(alignment: .trailing, spacing: 12) {
                    if !part.text.isEmpty { promptBubble(part.text, status: "", id: part.id) }
                    ForEach(part.images) { NativeAgentImageView(image: $0) }
                }
            case .text:
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(NativeAgentMarkdownBlock.parse(part.text)) { block in
                        if let image = block.image { NativeAgentImageView(image: image) }
                        else if !block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(.init(MentionCodec.displayText(in: block.text))).font(.system(size: 15 * rem)).lineSpacing(6).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    ForEach(part.images) { NativeAgentImageView(image: $0) }
                }
            case .thought:
                DisclosureGroup("Thinking") { Text(part.text).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled).padding(.top, 6) }
                    .font(.caption).foregroundStyle(.secondary)
            case .tool:
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 8) {
                        if !part.detail.isEmpty { Text(part.detail).font(.system(.caption, design: .monospaced)) }
                        if !part.text.isEmpty { Text(part.text).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                        ForEach(part.images) { NativeAgentImageView(image: $0) }
                    }.padding(.top, 6)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: part.status == "completed" ? "checkmark" : part.status == "failed" ? "exclamationmark.circle" : "wrench.and.screwdriver")
                        Text(part.title).lineLimit(2)
                    }.font(.caption).foregroundStyle(.secondary)
                }
            case .plan:
                DisclosureGroup("Plan") { Text(part.text).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6) }.font(.caption)
            case .permission:
                VStack(alignment: .leading, spacing: 12) {
                    Label(part.text, systemImage: "hand.raised").font(.subheadline)
                    if let permission = part.permission, !permission.answered {
                        ForEach(permission.options.indices, id: \.self) { index in
                            let option = permission.options[index]
                            if let optionID = option["optionId"].string {
                                Button(option["name"].string ?? optionID) { Task { await model.answer(permission, optionID: optionID) } }
                                    .buttonStyle(.bordered).disabled(model.record?.canEdit != true || model.pendingPermissionAnswers.contains(permission.requestID))
                            }
                        }
                    } else { Text(part.status == "Canceled" ? "No longer waiting" : "Answered").font(.caption).foregroundStyle(.secondary) }
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            case .question:
                VStack(alignment: .leading, spacing: 8) {
                    Text(part.text).font(.subheadline)
                    if part.status != "Answered" && part.status != "Canceled" { Button("Answer form") { showWebForm = true }.font(.subheadline) }
                    else { Text(part.status == "Canceled" ? "No longer waiting" : "Answered").font(.caption).foregroundStyle(.secondary) }
                }
            case .notice: Text(part.text).font(.caption).foregroundStyle(.secondary)
            }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("agent-part-\(part.id)")
    }

    private func promptBubble(_ text: String, status: String, id: String) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(MentionCodec.displayText(in: text)).font(.system(size: 15 * rem)).textSelection(.enabled).padding(.horizontal, 14).padding(.vertical, 10)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            if !status.isEmpty { Text(status).font(.caption2).foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 36)
            .accessibilityElement(children: .contain).accessibilityIdentifier("agent-prompt-\(id)")
    }

    private func changesReadyCard(_ changeset: NativeAgentChangeset) -> some View {
        VStack(alignment: .leading, spacing: 10.625) {
            HStack {
                MacroIcon(name: "git-branch", size: 17).foregroundStyle(MacroTheme.accent)
                Text("Changes ready to review").font(.system(size: 12.5, weight: .semibold))
                Spacer()
                Button { dismissedChangesID = changeset.id } label: { MacroIcon(name: "x", size: 25.5).frame(width: 38.25, height: 38.25).contentShape(Circle()) }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Dismiss changes summary")
            }
            HStack(spacing: 8) {
                Text("\(changeset.files.count) file\(changeset.files.count == 1 ? "" : "s")").foregroundStyle(.secondary)
                Text("+\(changeset.additions)").foregroundStyle(.green)
                Text("−\(changeset.deletions)").foregroundStyle(.red)
            }.font(.system(size: 11, design: .monospaced))
            HStack(spacing: 6.375) {
                NativeAgentOutlineButton(title: "Review changes", icon: "rows", identifier: "agent-review-changes") { showChanges = true }
                if let url = pullRequestURL {
                    NativeAgentOutlineButton(title: "Pull request #" + url.lastPathComponent, icon: "git-pull-request") { UIApplication.shared.open(url) }
                }
            }
        }.padding(12.75).background(Color(uiColor: .secondarySystemBackground).opacity(0.8), in: RoundedRectangle(cornerRadius: 12.75))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(.separator.opacity(0.35), lineWidth: 0.5))
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let changeset = model.changes?.changeset, !changeset.files.isEmpty, dismissedChangesID != changeset.id {
                changesReadyCard(changeset)
            }
            if let error = model.error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry") { Task { await model.retryLoad() } }.font(.caption)
                }
            }
            if model.record?.canEdit == true {
                VStack(alignment: .leading, spacing: 0) {
                    if let chat {
                        ZStack(alignment: .topLeading) {
                            if model.draft.isEmpty { Text("Message the agent, @mention anything").font(.system(size: 15 * rem)).foregroundStyle(.tertiary).padding(.leading, 9).padding(.top, 14).allowsHitTesting(false) }
                            NativeMentionEditor(wire: $model.draft, height: $composerHeight, channel: Channel(id: item.id, name: model.bot.name), store: chat, session: session, plain: true, includeGroups: false, accessibilityID: "agent-composer", compact: true)
                                .frame(height: composerHeight)
                        }
                    } else {
                        TextField("Message the agent, @mention anything", text: $model.draft, axis: .vertical)
                            .font(.system(size: 15 * rem)).lineLimit(2...6).padding(.horizontal, 3)
                            .accessibilityIdentifier("agent-composer")
                    }
                    if !model.draftAttachments.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(model.draftAttachments) { attachment in
                                    HStack(spacing: 5) {
                                        Image(systemName: "doc")
                                        Text(attachment.name).lineLimit(1)
                                        Button { model.draftAttachments.removeAll { $0.id == attachment.id } } label: { Image(systemName: "xmark.circle.fill") }
                                            .accessibilityLabel("Remove " + attachment.name)
                                    }.font(.system(size: 12)).padding(7).background(.quaternary, in: Capsule())
                                }
                            }
                        }
                    }
                    if let error = dictation.error { Text(error).font(.caption).foregroundStyle(.secondary) }
                    HStack(spacing: 2) {
                        Menu {
                            ForEach(model.transcript.models) { option in
                                Button(option.name) { Task { await model.changeModel(option.id) } }
                            }
                        } label: {
                            HStack(spacing: 5) {
                                MacroIcon(name: "sparkle", size: 20)
                                Text(model.transcript.models.first { $0.id == (model.transcript.currentModel ?? model.record?.model) }?.name ?? (model.record?.model == "auto" ? "Auto" : model.record?.model ?? "Auto")).lineLimit(1)
                                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                            }.font(.system(size: 13)).foregroundStyle(.secondary)
                        }.disabled(model.transcript.models.isEmpty).accessibilityLabel("Choose model").accessibilityIdentifier("agent-model-picker")
                        NativeAgentFooterButton(image: "paperclip", title: "Attach file", identifier: "agent-attach", enabled: model.draftAttachments.count < 10) { showAttachments = true }
                            .frame(width: 44, height: 44)
                        Spacer()
                        NativeAgentFooterButton(image: "microphone", title: dictation.recording ? "Stop dictation" : "Dictate message", identifier: "agent-dictate", tint: dictation.recording ? .systemRed : .label) {
                            if dictation.recording { dictation.stop() }
                            else if session.isDemo { dictation.error = "Dictation is available after signing in." }
                            else {
                                let prefix = model.draft.isEmpty ? "" : model.draft + " "
                                Task { await dictation.start { model.draft = prefix + $0 } }
                            }
                        }.frame(width: 44, height: 44)
                    if model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && model.draftAttachments.isEmpty && model.transcript.isWorking {
                        NativeAgentFooterButton(image: "stop.fill", isSymbol: true, pointSize: 14, title: model.stopping ? "Stopping agent" : "Stop agent", identifier: "agent-stop", enabled: !model.stopping, tint: .secondaryLabel, filled: true) { Task { await model.stopAgent() } }
                            .frame(width: 44, height: 44)
                    } else {
                        NativeAgentFooterButton(image: "arrow.up.circle.fill", isSymbol: true, pointSize: 32, title: "Send to agent", identifier: "agent-send", enabled: !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !model.draftAttachments.isEmpty, tint: UIColor(MacroTheme.accent)) { dictation.stop(); if model.send() != nil { scrollRequest += 1 } }
                            .frame(width: 44, height: 44)
                    }
                    }.buttonStyle(.plain)
                }.padding(6).modifier(NativeAgentComposerGlass())
            } else if model.record != nil { Text("You have view access to this conversation.").font(.caption).foregroundStyle(.secondary) }
        }.padding(.horizontal, 12).padding(.vertical, 8).padding(.bottom, nativeChromeBottom)
    }
}

enum NativeAgentStartAction: String, Identifiable {
    case prompt, attachments, dictation
    var id: String { rawValue }
}

struct NativeAgentStartView: View {
    let session: NativeSession
    let store: ChatStore?
    @State private var cognition: NativeCognitionStore?
    init(session: NativeSession, store: ChatStore? = nil, initialAction: NativeAgentStartAction = .prompt, onCreated: @escaping () -> Void = {}) {
        self.session = session; self.store = store
        _cognition = State(initialValue: store.map { NativeCognitionStore(session: session, chat: $0, draftKey: "agent-new") })
    }
    var body: some View {
        if let cognition, let store { NativeCognitionDestination(model: cognition, store: store, session: session, isNew: true) }
        else { ContentUnavailableView("Conversation unavailable", systemImage: "bubble.left") }
    }
}

/// Initial actions run after the outer sheet finishes appearing, so a file
/// chooser is not presented while UIKit is still presenting its parent.
private struct NativeAgentStartAppearance: UIViewControllerRepresentable {
    let onAppear: () -> Void
    func makeUIViewController(context: Context) -> Controller { Controller(onAppear: onAppear) }
    func updateUIViewController(_ controller: Controller, context: Context) { controller.onAppear = onAppear }
    final class Controller: UIViewController {
        var onAppear: () -> Void
        init(onAppear: @escaping () -> Void) { self.onAppear = onAppear; super.init(nibName: nil, bundle: nil) }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func loadView() { view = UIView(); view.isUserInteractionEnabled = false; view.backgroundColor = .clear }
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            DispatchQueue.main.async { [weak self] in self?.onAppear() }
        }
    }
}

struct NativeAgentListRow: View {
    let item: WorkspaceItem
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MacroIcon(name: "sparkle", size: 18).foregroundStyle(.secondary).frame(width: 22).padding(.top, 3)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.subheadline.weight(item.isUnread ? .semibold : .regular)).lineLimit(2).foregroundStyle(.primary)
                if !item.subtitle.isEmpty { Text(MentionCodec.displayText(in: item.subtitle)).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                if !item.displayStatus.isEmpty { Text(item.displayStatus).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            if item.date > .distantPast { Text(NativeTimestamp.relative(item.date)).font(.caption2).foregroundStyle(.tertiary) }
            if item.isUnread { Circle().fill(MacroTheme.accent).frame(width: 5, height: 5).padding(.top, 6) }
        }.padding(.vertical, 6).contentShape(Rectangle())
    }
}

struct NativeAgentComposerGlass: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26, *) { content.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 24)).shadow(color: .black.opacity(0.12), radius: 12, y: 4) }
        else { content.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24)).overlay(RoundedRectangle(cornerRadius: 24).stroke(.separator.opacity(0.4), lineWidth: 0.5)) }
    }
}
