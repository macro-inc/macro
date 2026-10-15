import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct EmailWorkspaceView: View {
    @State private var store: EmailStore
    @State private var selectedItem: EmailPreview?
    @State private var showsFilters = false
    let createRequest: Int
    let session: NativeSession
    var chat: ChatStore?
    let onDetailChange: (Bool) -> Void
    var onComposeChange: (Bool) -> Void = { _ in }

    init(session: NativeSession, chat: ChatStore? = nil, createRequest: Int = 0, onComposeChange: @escaping (Bool) -> Void = { _ in }, onDetailChange: @escaping (Bool) -> Void = { _ in }) {
        _store = State(initialValue: EmailStore(session: session))
        self.createRequest = createRequest
        self.session = session; self.chat = chat
        self.onDetailChange = onDetailChange
        self.onComposeChange = onComposeChange
    }
    var body: some View {
        @Bindable var store = store
        let rows = store.items
        List {
            if let error = store.error { emailError(error) { Task { await store.load() } } }
            if store.didLoad && store.inboxes.isEmpty {
                ContentUnavailableView("No connected inbox", systemImage: "envelope", description: Text("Connect your email account in Macro to see it here."))
            } else if store.isLoading && store.items.isEmpty {
                HStack { Spacer(); ProgressView("Loading email"); Spacer() }.listRowSeparator(.hidden).padding(.vertical, 40)
            } else if store.items.isEmpty && store.didLoad {
                ContentUnavailableView(store.query.isSearch ? "No matching emails" : "You're all caught up", systemImage: store.query.isSearch ? "magnifyingglass" : "tray", description: Text(store.query.isSearch ? "Try another name or phrase." : "New email will appear here."))
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                if index == 0 || EmailDateGrouping.title(rows[index - 1].date) != EmailDateGrouping.title(item.date) {
                    Text(EmailDateGrouping.title(item.date)).font(.system(size: 12)).foregroundStyle(.secondary)
                        .listRowInsets(EdgeInsets(top: index == 0 ? 4 : 16, leading: 24, bottom: 4, trailing: 16))
                        .listRowBackground(MacroTheme.background).listRowSeparator(.hidden)
                }
                Button { selectedItem = item } label: {
                    EmailPreviewRow(item: item, sender: item.senderLabel(excluding: Set(store.inboxes.map { $0.email_address.lowercased() })), viewerName: session.displayName ?? session.email,
                        viewerPhoto: session.userID.flatMap { chat?.photos[$0] })
                }.buttonStyle(NativeListRowButtonStyle(selected: selectedItem?.id == item.id))
                .accessibilityIdentifier("email-thread-\(item.id)")
                .listRowInsets(EdgeInsets()).listRowSeparator(.hidden)
                .listRowBackground(MacroTheme.background)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button { Task { await archivePreview(item) } } label: { Label(item.inboxVisible ? "Archive" : "Move to inbox", systemImage: item.inboxVisible ? "archivebox" : "tray.and.arrow.down") }.tint(.accentColor)
                }
            }
            if store.cursor != nil {
                Button { Task { await store.loadMore() } } label: {
                    HStack { Spacer(); if store.isLoadingMore { ProgressView() } else { Text("Load more emails") }; Spacer() }
                }.disabled(store.isLoadingMore).accessibilityIdentifier("email-load-more")
            }
        }
        .listStyle(.plain).scrollContentBackground(.hidden).refreshable { await store.load() }
        .nativeChromeInset()
        .accessibilityIdentifier("email-list-\(store.loadedQuery == store.query && !store.isLoading ? "ready" : "loading")")
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
            NativePillBar(options: EmailTab.allCases.map { ($0.rawValue.lowercased(), $0.rawValue) },
                selection: Binding(get: { store.query.tab.rawValue.lowercased() }, set: { value in
                    if let tab = EmailTab.allCases.first(where: { $0.rawValue.lowercased() == value }) { store.query.tab = tab }
                }), filterAction: { showsFilters = true }, filterIdentifier: "email-filters", accessibilityPrefix: "email-tab-")
            if !store.query.text.isEmpty {
                HStack {
                    Image(systemName: "magnifyingglass")
                    Text(store.query.text).lineLimit(1)
                    Spacer()
                    Button { store.query.text = "" } label: { Image(systemName: "xmark") }.accessibilityLabel("Clear email search")
                }.font(.system(size: 13)).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 7)
            }
            if store.query.isSearch && [.sent, .drafts, .all].contains(store.query.tab) {
                Text("Searching all your email").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.bottom, 6)
            }
            if let notice = store.notice {
                HStack { Label(notice, systemImage: "checkmark.circle.fill"); Spacer(); Button { store.notice = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Dismiss confirmation") }
                    .font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 8)
            }
            }
            .background { LinearGradient(colors: [MacroTheme.background.opacity(0.9), MacroTheme.background.opacity(0)], startPoint: .top, endPoint: .bottom) }
        }
        .background(MacroTheme.background)
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { onDetailChange(false) }
        .task(id: store.query) {
            if !store.query.text.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await store.load()
        }
        .onChange(of: createRequest) { _, _ in store.compose() }
        .onChange(of: store.composition?.id) { _, id in onComposeChange(id != nil) }
        .navigationDestination(isPresented: Binding(get: { selectedItem != nil }, set: { if !$0 { selectedItem = nil } })) {
            if let item = selectedItem { EmailThreadView(id: item.id, title: item.subject, workspace: store, onDetailChange: onDetailChange) }
        }
        .fullScreenCover(isPresented: $showsFilters) {
            EmailFilterDrawer(store: store, onClose: { showsFilters = false }).presentationBackground(.clear)
        }
        .navigationDestination(isPresented: Binding(get: { store.composition != nil }, set: { if !$0 { store.composition = nil; onComposeChange(false) } })) {
            if let draft = store.composition {
                EmailComposeView(draft: draft, workspace: store, chat: chat).onAppear { onDetailChange(false); onComposeChange(true) }.onDisappear { onComposeChange(false) }
            }
        }
    }
    private func archivePreview(_ item: EmailPreview) async {
        do {
            var thread = try await store.service.thread(item.id, offset: 0)
            try await store.service.archive(thread.id, inboxID: thread.link_id, value: thread.inbox_visible)
            thread.inbox_visible.toggle(); store.update(thread)
        } catch { store.error = error.localizedDescription }
    }
}

/// Allows notifications and global search to open the same native reader and composer.
struct NativeEmailDestination: View {
    @State private var workspace: EmailStore
    let threadID: String
    let onDetailChange: (Bool) -> Void
    init(session: NativeSession, threadID: String, onDetailChange: @escaping (Bool) -> Void = { _ in }) {
        _workspace = State(initialValue: EmailStore(session: session))
        self.threadID = threadID
        self.onDetailChange = onDetailChange
    }
    var body: some View {
        @Bindable var workspace = workspace
        EmailThreadView(id: threadID, title: "Email", workspace: workspace, onDetailChange: onDetailChange)
            .task { await workspace.loadInboxes() }
            .navigationDestination(isPresented: Binding(get: { workspace.composition != nil }, set: { if !$0 { workspace.composition = nil } })) {
                if let draft = workspace.composition { EmailComposeView(draft: draft, workspace: workspace) }
            }
    }
}

private struct EmailPreviewRow: View {
    let item: EmailPreview
    let sender: String
    let viewerName: String
    let viewerPhoto: URL?
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.primary.opacity(0.035))
                MacroIcon(name: item.isCalendarInvite ? "calendar" : "envelope", size: 24)
                    .foregroundStyle(item.isCalendarInvite ? Color.yellow : Color.secondary)
            }.frame(width: 44, height: 44).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    if item.isDraft { Text("DRAFT").font(.system(size: 9, weight: .medium)).foregroundStyle(.orange) }
                    Text(sender).font(.system(size: 15, weight: item.isRead ? .medium : .semibold)).lineLimit(1)
                    Spacer(minLength: 4)
                    AvatarView(name: viewerName, size: 16, photoURL: viewerPhoto).accessibilityHidden(true)
                    Text(item.date, format: .dateTime.month(.abbreviated).day()).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(item.subject).font(.system(size: 15)).lineLimit(1)
                if !item.snippet.isEmpty { Text(item.snippet).font(.system(size: 15)).foregroundStyle(.secondary).lineLimit(1) }
            }.padding(.vertical, 12).overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.07)).frame(height: 0.5) }
        }.frame(minHeight: 80).frame(maxWidth: .infinity).contentShape(Rectangle())
            .accessibilityElement(children: .combine)
    }
}

struct EmailThreadView: View {
    @State private var store: EmailThreadStore
    let title: String
    let onDetailChange: (Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeChromeBottom) private var nativeChromeBottom
    @State private var formattedMessage: EmailMessage?
    @State private var expandedRecipients: Set<String> = []
    @State private var copiedSubject = false

    init(id: String, title: String, workspace: EmailStore, onDetailChange: @escaping (Bool) -> Void = { _ in }) {
        _store = State(initialValue: EmailThreadStore(id: id, workspace: workspace))
        self.title = title; self.onDetailChange = onDetailChange
    }
    private var subject: String { store.thread?.subject ?? store.workspace.items.first(where: { $0.id == store.id })?.subject ?? title }
    private var lastMessage: EmailMessage? { store.thread?.lastMessage }
    private var previous: EmailPreview? { neighbor(-1) }
    private var next: EmailPreview? { neighbor(1) }

    var body: some View {
        ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(subject).font(.system(size: 20, weight: .semibold)).tracking(-0.5).textSelection(.enabled)
                            .accessibilityIdentifier("email-reader-subject")
                        Button {
                            UIPasteboard.general.string = subject; copiedSubject = true
                        } label: { MacroIcon(name: copiedSubject ? "check" : "copy", size: 16) }
                            .buttonStyle(.plain).foregroundStyle(.secondary).frame(minWidth: 28, minHeight: 32)
                            .accessibilityLabel(copiedSubject ? "Subject copied" : "Copy subject").accessibilityIdentifier("email-copy-subject")
                        Spacer(minLength: 0)
                    }.padding(.horizontal, 16).padding(.top, 24).padding(.bottom, 16)
                    Divider().overlay(Color.primary.opacity(0.03))
                    if let error = store.error ?? store.workspace.error {
                        emailError(error) { Task { await store.workspace.loadInboxes(); await store.load() } }.padding(.horizontal, 16)
                    }
                    if store.isLoading && store.thread == nil { ProgressView("Loading conversation").frame(maxWidth: .infinity).padding(30) }
                    if store.hasMore {
                        Button("Load earlier messages") { Task { await store.load(older: true) } }
                            .disabled(store.isLoading).padding(16).accessibilityIdentifier("email-earlier-messages")
                    }
                    if let thread = store.thread {
                        ForEach(thread.messages) { message in
                            messageView(message)
                            if message.id != thread.messages.last?.id { Divider().padding(.top, 24) }
                        }
                    }
                }.padding(.top, 46).padding(.bottom, nativeChromeBottom + (lastMessage == nil ? 28 : 60))
        }
        .id(store.id).accessibilityIdentifier("email-reader-scroll")
        .overlay(alignment: .top) {
            readerHeader.background {
                LinearGradient(colors: [MacroTheme.background.opacity(0.9), MacroTheme.background.opacity(0)], startPoint: .top, endPoint: .bottom)
            }
        }
        .overlay(alignment: .bottom) {
            if lastMessage != nil {
                bottomActions.padding(.horizontal, 12).padding(.top, 12).padding(.bottom, nativeChromeBottom + 8)
                    .background {
                        LinearGradient(colors: [MacroTheme.background.opacity(0), MacroTheme.background.opacity(0.8)], startPoint: .top, endPoint: .bottom)
                    }
            }
        }
        .background(MacroTheme.background)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: store.id) { if store.thread == nil { await store.load() } }
        .onAppear { onDetailChange(true) }
        .onDisappear { onDetailChange(false) }
        .onChange(of: store.workspace.notice) { _, value in if value != nil { Task { await store.load() } } }
        .sheet(item: $formattedMessage) { message in
            NavigationStack {
                EmailHTMLBody(html: message.body_html_sanitized ?? "")
                    .navigationTitle(message.subject ?? "Email").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { formattedMessage = nil } } }
            }
        }
    }
    private var readerHeader: some View {
        HStack(spacing: 8) {
            Button { dismiss() } label: { MacroIcon(name: "caret-left", size: 24).frame(width: 40, height: 40) }
                .buttonStyle(EmailIslandStyle()).accessibilityLabel("Back to email").accessibilityIdentifier("email-back")
            Menu {
                Button("Back to inbox", systemImage: "tray") { dismiss() }
                Button("Copy subject", systemImage: "square.on.square") { UIPasteboard.general.string = subject; copiedSubject = true }
            } label: {
                HStack(spacing: 8) {
                    MacroIcon(name: "envelope", size: 16)
                    Text(subject).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    Spacer(minLength: 0)
                    MacroIcon(name: "caret-down", size: 14).foregroundStyle(.secondary)
                }.padding(.horizontal, 13).frame(maxWidth: .infinity).frame(height: 40).emailIsland()
            }.buttonStyle(.plain).accessibilityIdentifier("email-reader-location")
            Menu {
                if let thread = store.thread {
                    Button(thread.isStarred ? "Unstar email" : "Star email", systemImage: thread.isStarred ? "star.fill" : "star") { Task { await store.toggleStar() } }.accessibilityIdentifier("email-star")
                    Button(thread.is_read ? "Mark unread" : "Mark read", systemImage: thread.is_read ? "envelope.badge" : "envelope.open") { Task { await store.toggleRead() } }
                    Button(thread.inbox_visible ? "Mark done" : "Mark not done", systemImage: "checkmark") { Task { await markDone() } }
                    if let message = lastMessage {
                        Button("Reply all", systemImage: "arrowshape.turn.up.left.2") { store.workspace.reply(message, all: true) }
                        if message.body_html_sanitized?.isEmpty == false {
                            Button("View formatted email", systemImage: "doc.richtext") { formattedMessage = message }.accessibilityIdentifier("email-formatted-\(message.id)")
                        }
                    }
                }
            } label: { MacroIcon(name: "info", size: 20).frame(width: 40, height: 40).emailIsland() }
                .buttonStyle(.plain).disabled(store.isUpdating).accessibilityLabel("Thread actions").accessibilityIdentifier("email-thread-actions")
        }.foregroundStyle(.primary).padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 2)
    }
    private func messageView(_ message: EmailMessage) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(String((message.from?.displayName ?? "?").prefix(1)).uppercased())
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(MacroTheme.background)
                    .frame(width: 24, height: 24).background(Color.gray, in: Circle()).accessibilityHidden(true)
                Button {
                    if !expandedRecipients.insert(message.id).inserted { expandedRecipients.remove(message.id) }
                } label: {
                    HStack(spacing: 5) {
                        Text(message.is_draft ? "Draft" : message.from?.displayName ?? "Unknown sender").foregroundStyle(.primary).lineLimit(1)
                        Text(recipientSummary(message)).foregroundStyle(.secondary).lineLimit(1).layoutPriority(-1)
                        MacroIcon(name: expandedRecipients.contains(message.id) ? "caret-down" : "caret-right", size: 12).foregroundStyle(.secondary)
                    }.font(.system(size: 15))
                }.buttonStyle(.plain).accessibilityLabel("Message details, \(message.from?.displayName ?? "Unknown sender")")
                    .accessibilityIdentifier("email-recipients-\(message.id)")
                Spacer(minLength: 0)
                if !message.is_draft {
                    Button { store.workspace.reply(message, all: false) } label: { MacroIcon(name: "arrow-bend-up-left", size: 16).frame(width: 22, height: 30) }
                        .accessibilityLabel("Reply to this message").accessibilityIdentifier("email-message-reply-\(message.id)")
                    Button { store.workspace.forward(message) } label: { MacroIcon(name: "arrow-bend-up-right", size: 16).frame(width: 22, height: 30) }
                        .accessibilityLabel("Forward this message").accessibilityIdentifier("email-message-forward-\(message.id)")
                }
                Text(message.date, format: .dateTime.month(.abbreviated).day()).font(.system(size: 14)).foregroundStyle(.secondary).fixedSize()
            }.font(.system(size: 13)).foregroundStyle(.secondary).buttonStyle(.plain).padding(.top, 14).padding(.bottom, 8)
            if expandedRecipients.contains(message.id) {
                VStack(alignment: .leading, spacing: 5) {
                    if let from = message.from { Text("From: \(from.email)") }
                    Text("To: " + message.to.map(\.email).joined(separator: ", "))
                    if !message.cc.isEmpty { Text("Cc: " + message.cc.map(\.email).joined(separator: ", ")) }
                    Text(message.date, format: .dateTime.year().month(.abbreviated).day().hour().minute())
                    Menu("Message actions", systemImage: "ellipsis") {
                        Button("Reply all", systemImage: "arrowshape.turn.up.left.2") { store.workspace.reply(message, all: true) }
                        if message.body_html_sanitized?.isEmpty == false {
                            Button("View formatted email", systemImage: "doc.richtext") { formattedMessage = message }
                        }
                    }.accessibilityIdentifier("email-message-actions-\(message.id)")
                }.font(.system(size: 12)).foregroundStyle(.secondary).textSelection(.enabled).padding(.bottom, 12)
            }
            if !message.text.isEmpty {
                EmailNativeBody(text: message.text, html: message.body_html_sanitized ?? "")
                    .font(.system(size: 15)).lineSpacing(4).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            } else if message.body_html_sanitized == nil {
                Text(message.snippet ?? "Empty message").font(.system(size: 15)).foregroundStyle(.secondary)
            }
            if !message.attachments.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(message.attachments) { attachment in
                        Button {
                            Task {
                                do { let url = try await store.workspace.service.attachmentURL(attachment.id); await UIApplication.shared.open(url) }
                                catch { store.error = error.localizedDescription }
                            }
                        } label: {
                            HStack(spacing: 7) {
                                MacroIcon(name: ["doc", "docx"].contains((attachment.filename ?? "").components(separatedBy: ".").last?.lowercased() ?? "") ? "file-doc" : "file", size: 16).foregroundStyle(Color.accentColor)
                                Text(attachment.filename ?? "Attachment").foregroundStyle(.primary).lineLimit(1)
                            }.font(.system(size: 13)).padding(.horizontal, 10).padding(.vertical, 10)
                                .background(Color.primary.opacity(0.015), in: RoundedRectangle(cornerRadius: 8))
                                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08), lineWidth: 1))
                        }.buttonStyle(.plain).accessibilityIdentifier("email-attachment-\(attachment.id)")
                    }
                }.padding(.top, 18)
            }
            if message.is_draft {
                Button("Edit draft", systemImage: "square.and.pencil") { store.workspace.composition = .editing(message) }
                    .padding(.top, 14).accessibilityIdentifier("email-edit-draft")
            }
        }.padding(.horizontal, 16)
    }
    private var bottomActions: some View {
        HStack(spacing: 8) {
            if let message = lastMessage {
                Button { store.workspace.reply(message, all: true) } label: {
                    Label { Text("Reply") } icon: { MacroIcon(name: "arrow-bend-up-left", size: 16) }.font(.system(size: 14)).padding(.horizontal, 11).frame(height: 34)
                }.buttonStyle(EmailIslandStyle()).accessibilityIdentifier("email-reply-\(message.id)")
                Button { store.workspace.forward(message) } label: {
                    Label { Text("Forward") } icon: { MacroIcon(name: "arrow-bend-up-right", size: 16) }.font(.system(size: 14)).padding(.horizontal, 11).frame(height: 34)
                }.buttonStyle(EmailIslandStyle()).accessibilityIdentifier("email-forward")
            }
            Spacer(minLength: 0)
            Button { if let previous { open(previous) } } label: { MacroIcon(name: "arrow-up", size: 24).frame(width: 34, height: 34) }
                .buttonStyle(EmailIslandStyle()).disabled(previous == nil || store.isUpdating).accessibilityLabel("Previous email").accessibilityIdentifier("email-previous")
            Button { if let next { open(next) } } label: { MacroIcon(name: "arrow-down", size: 24).frame(width: 34, height: 34) }
                .buttonStyle(EmailIslandStyle()).disabled(next == nil || store.isUpdating).accessibilityLabel("Next email").accessibilityIdentifier("email-next")
            Button { Task { await markDone() } } label: {
                MacroIcon(name: "check", size: 24).frame(width: 34, height: 34)
                    .foregroundStyle(store.thread?.inbox_visible == false ? Color.accentColor : Color.primary)
            }.buttonStyle(EmailIslandStyle()).disabled(store.isUpdating).accessibilityLabel(store.thread?.inbox_visible == false ? "Mark not done" : "Mark done").accessibilityIdentifier("email-done")
        }.foregroundStyle(.primary)
    }
    private func neighbor(_ offset: Int) -> EmailPreview? {
        let items = store.workspace.items
        guard let index = items.firstIndex(where: { $0.id == store.id }), items.indices.contains(index + offset) else { return nil }
        return items[index + offset]
    }
    private func open(_ item: EmailPreview) {
        store = EmailThreadStore(id: item.id, workspace: store.workspace)
        expandedRecipients.removeAll(); copiedSubject = false
    }
    private func markDone() async {
        let current = store
        let shouldAdvance = current.thread?.inbox_visible == true
        let following = next ?? previous
        await current.archive()
        guard current.error == nil, current.id == store.id, shouldAdvance else { return }
        if let following { open(following) } else { dismiss() }
    }
    private func recipientSummary(_ message: EmailMessage) -> String {
        let ownAddresses = Set(store.workspace.inboxes.map { $0.email_address.lowercased() })
        let names = message.to.map { ownAddresses.contains($0.email.lowercased()) ? "Me" : $0.displayName }
        return "to " + names.joined(separator: ", ")
    }
}

private struct EmailNativeBody: View {
    let text: String
    let html: String
    @State private var formatted: AttributedString?
    var body: some View {
        Text(formatted ?? AttributedString(text))
            .accessibilityIdentifier(formatted == nil ? "email-render-pending" : "email-rendered-body")
            .task(id: text + html) {
                let projection = await Task.detached {
                    let content = EmailBodyFormatting.nativeText(html: html, plainText: text)
                    return (content, EmailBodyFormatting.spans(html: html, plainText: content))
                }.value
                guard !Task.isCancelled else { return }
                var result = AttributedString(projection.0)
                for span in projection.1 {
                    guard let range = Range(span.range, in: projection.0),
                          let lower = AttributedString.Index(range.lowerBound, within: result),
                          let upper = AttributedString.Index(range.upperBound, within: result) else { continue }
                    let selected = lower..<upper
                    switch span.style {
                    case .bold: result[selected].inlinePresentationIntent = (result[selected].inlinePresentationIntent ?? []).union(.stronglyEmphasized)
                    case .italic: result[selected].inlinePresentationIntent = (result[selected].inlinePresentationIntent ?? []).union(.emphasized)
                    case .link(let url): result[selected].link = url
                    }
                }
                formatted = result
            }
    }
}

private struct EmailIslandStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.emailIsland().opacity(!enabled ? 0.35 : configuration.isPressed ? 0.65 : 1)
    }
}
private extension View {
    func emailIsland() -> some View {
        nativeGlass().contentShape(Capsule())
    }
}

@ViewBuilder private func emailError(_ text: String, retry: @escaping () -> Void) -> some View {
    VStack(alignment: .leading, spacing: 8) {
        Text(text).font(.subheadline).foregroundStyle(.secondary)
        Button("Try again", action: retry).font(.subheadline)
    }.padding(.vertical, 10).accessibilityIdentifier("email-error")
}

/// Displays only the server-sanitized body; no Macro website or login is loaded.
/// Remote resources and scripts stay blocked so reading an email does not load tracking pixels.
private struct EmailHTMLBody: UIViewRepresentable {
    let html: String
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != html else { return }
        context.coordinator.loaded = html
        let head = "<meta name='viewport' content='width=device-width, initial-scale=1'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline';\"><style>:root{color-scheme:light dark}body{font:15px -apple-system;margin:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}</style>"
        view.loadHTMLString(head + html, baseURL: nil)
    }
    final class Coordinator: NSObject, WKNavigationDelegate {
        var loaded: String?
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated, let url = action.request.url {
                if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { UIApplication.shared.open(url) }
                decisionHandler(.cancel)
            } else { decisionHandler(action.request.url?.scheme == "about" ? .allow : .cancel) }
        }
    }
}
