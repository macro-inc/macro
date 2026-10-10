import SwiftUI
import UIKit

struct ConversationView: View {
    let channel: Channel
    let store: ChatStore
    let session: NativeSession
    let initialMessageID: String?
    let initialThreadID: String?
    @State private var navigationTargetID: String?
    @State private var showWeb = false
    @State private var showCall = false
    @State private var showInfo = false
    @State private var showTitleMenu = false
    @State private var selectedTab = NativeChannelTab.messages
    @State private var showAskMacro = false
    @State private var showAttachmentPicker = false
    @State private var replyRootID: String?
    @State private var actionMessage: ChatMessage?
    @State private var taskMessage: ChatMessage?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeChromeTop) private var chromeTop
    @State private var editing: ChatMessage?
    @State private var deleting: ChatMessage?
    @State private var attachment: MessageAttachment?
    @State private var actionError: String?
    @State private var agentSession: WorkspaceItem?
    @State private var readTask: Task<Void, Never>?
    @State private var mentionSearch: MentionSearchService

    init(channel: Channel, store: ChatStore, session: NativeSession, initialMessageID: String? = nil, initialThreadID: String? = nil) {
        self.channel = channel; self.store = store; self.session = session
        self.initialMessageID = initialMessageID; self.initialThreadID = initialThreadID
        _mentionSearch = State(initialValue: MentionSearchService(session: session))
    }

    var body: some View {
        VStack(spacing: 0) {
            if store.isChannelInaccessible(channel.id) {
                ContentUnavailableView("Conversation unavailable", systemImage: "lock", description: Text("You no longer have access to this conversation."))
            } else if selectedTab == .attachments {
                NativeChannelAttachmentsView(session: session, store: store, channel: channel) { attachment = $0 }
            } else if selectedTab == .calls {
                NativeChannelCallsView(session: session, store: store, channel: channel)
            } else if selectedTab == .participants {
                NativeChannelParticipantsView(session: session, store: store, channel: channel)
            } else {
            NativeConversation(store: store, replyRootID: replyRootID, editingMessage: editing, targetMessageID: navigationTargetID ?? initialMessageID, channel: store.channels.first(where: { $0.id == channel.id }) ?? channel, actions: ConversationActions(
                isDemo: session.isDemo, session: session, store: store, channel: channel, openWeb: { showWeb = true }, searchMentions: { query in
                    await mentionSearch.search(query)
                }, moreMentions: { query in await mentionSearch.loadMore(query) }, hasMoreMentions: { mentionSearch.hasMore($0) }, viewed: { viewedLatest($0) }, attach: { showAttachmentPicker = true }, reply: { beginReply($0) }, expand: { message in store.expandThread(rootID: message.id); Task { await store.loadThread(channelID: channel.id, rootID: message.id) } }, closeReply: { replyRootID = nil; editing = nil }, menu: { actionMessage = $0 },
                react: { message, emoji in Task { await react(message, emoji: emoji) } },
                edit: { replyRootID = nil; editing = $0 }, delete: { deleting = $0 }, attachment: { attachment = $0 }, agent: { agentSession = WorkspaceItem(id: $0, kind: .agent, title: "Agent") }))
            }
        }
        .background(MacroTheme.background)
        .ignoresSafeArea(edges: .top)
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) { VStack(spacing: 0) { floatingHeader; connectionNotices } }
        .onChange(of: store.isChannelInaccessible(channel.id)) { _, denied in
            if denied { showInfo = false; showCall = false; showAttachmentPicker = false; replyRootID = nil; actionMessage = nil; editing = nil; attachment = nil }
        }
        .task {
            await store.open(channel)
            if let initialMessageID {
                navigationTargetID = await store.loadTarget(channelID: channel.id, messageID: initialMessageID, threadID: initialThreadID)
            }
            if let viewed = try? await ChatActions(session: session).markRead(channelID: channel.id) { store.markViewed(channelID: channel.id, at: viewed) }
        }
        .onDisappear { store.close(channel.id) }
        .sheet(isPresented: $showAttachmentPicker) {
            ChannelAttachmentPicker(session: session, alreadySelected: Set((store.draftAttachments[channel.id] ?? []).map { $0.attachment.entityID })) { attachment, title in
                var attachments = store.draftAttachments[channel.id] ?? []
                attachments.append(ChannelDraftAttachment(attachment: attachment, title: title))
                store.setDraftAttachments(attachments, channelID: channel.id)
            }
        }
        .fullScreenCover(isPresented: $showInfo) {
            NativeChannelInviteDrawer(session: session, store: store, channel: store.channels.first(where: { $0.id == channel.id }) ?? channel).presentationBackground(.clear)
        }
        .fullScreenCover(isPresented: $showTitleMenu) {
            NativeChannelMenu(session: session, store: store, channel: store.channels.first(where: { $0.id == channel.id }) ?? channel, selected: selectedTab,
                onSelect: { selectedTab = $0 }, onAsk: {
                    let mention = MentionCandidate(kind: .channel, id: channel.id, title: store.title(for: channel)).token.wire
                    let existing = store.drafts["agent-new"] ?? ""
                    if !existing.contains(mention) { store.setDraft(existing + (existing.isEmpty ? "" : "\n") + mention + " ", channelID: "agent-new") }
                    showAskMacro = true
                }).presentationBackground(.clear)
        }
        .navigationDestination(isPresented: $showAskMacro) { NativeAgentStartView(session: session, store: store) }
        .navigationDestination(isPresented: Binding(get: { agentSession != nil }, set: { if !$0 { agentSession = nil } })) {
            if let item = agentSession { NativeAgentDestination(session: session, item: item, store: store) }
        }
        .fullScreenCover(item: $actionMessage) { message in
            NativeMessageActionsSheet(message: message, userID: store.userID, webURL: session.environment.webURL,
                canWrite: store.canCompose(in: channel), onReply: { beginReply(message) },
                onReact: { emoji in Task { await react(message, emoji: emoji) } },
                onCreateTask: { taskMessage = message }, onEdit: { replyRootID = nil; editing = message }, onDelete: { deleting = message }).presentationBackground(.clear)
        }
        .fullScreenCover(item: $taskMessage) { message in NativeMessageTaskSheet(message: message, channelName: store.title(for: channel), session: session, onCreated: { _ in taskMessage = nil }).presentationBackground(.clear) }
        .sheet(item: Binding(get: { attachment.flatMap { $0.entityType.hasPrefix("static/") ? $0 : nil } }, set: { attachment = $0 })) { item in
            ChannelMediaAttachmentView(session: session, attachment: item)
        }
        .navigationDestination(isPresented: Binding(get: { attachment.map { !$0.entityType.hasPrefix("static/") } ?? false }, set: { if !$0 { attachment = nil } })) {
            if let item = attachment { ChannelAttachmentDestination(attachment: item, session: session, store: store, channel: channel) }
        }
        .alert("Delete message?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Cancel", role: .cancel) { deleting = nil }
            Button("Delete", role: .destructive) { if let message = deleting { Task { await delete(message) } }; deleting = nil }
        } message: { Text("This message will be removed for everyone in the conversation.") }
        .alert("Couldn't update message", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
        .sheet(isPresented: $showCall) {
            if session.isDemo { ContentUnavailableView("Call preview", systemImage: "phone", description: Text("Calls are available when signed in.")) }
            else { WorkspaceSheet(session: session, url: session.environment.webURL.appendingPathComponent("channel/\(channel.id)").appending(queryItems: [URLQueryItem(name: "join_call", value: "true")])) }
        }
        .sheet(isPresented: $showWeb) {
            WorkspaceSheet(session: session, url: session.environment.webURL.appendingPathComponent("channel/\(channel.id)"))
        }
    }
    private var connectionNotices: some View {
        VStack(spacing: 0) {
            if store.status != .connected {
                HStack(spacing: 7) {
                    ProgressView().controlSize(.mini)
                    Text(store.status == .disconnected ? "Offline · your drafts are saved" : "Connecting to your conversations…")
                        .font(.caption)
                }.foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(8)
            }
            if let error = store.messageErrors[channel.id] {
                HStack {
                    Text(error).font(.caption).lineLimit(2)
                    Spacer()
                    Button("Retry") { Task { await store.loadLatest(channel.id) } }.font(.caption.bold())
                }.foregroundStyle(.secondary).padding(12).background(Color(uiColor: .secondarySystemBackground))
            }
        }
    }

    private var floatingHeader: some View {
        HStack(spacing: 8.5) {
            Button { dismiss() } label: { MacroIcon(name: "caret-left", size: 24).frame(width: 46, height: 42.5).contentShape(Capsule()) }
                .nativeGlass().accessibilityLabel("Back").accessibilityIdentifier("channel-back")
            if !store.isChannelInaccessible(channel.id) {
                Button { showTitleMenu = true } label: {
                    HStack(spacing: 8.5) {
                        if channel.channelType != "direct_message" { MacroIcon(name: "hash-straight", size: 17) }
                        Text(store.title(for: channel)).font(.system(size: 14.875, weight: .semibold)).lineLimit(1)
                        MacroIcon(name: "caret-down", size: 17)
                    }.padding(.horizontal, 12.75).frame(height: 42.5)
                }.nativeGlass().accessibilityLabel("Channel details")
                Spacer(minLength: 0)
                Button { showInfo = true } label: { MacroIcon(name: "user-plus", size: 24).frame(width: 32, height: 40) }.accessibilityLabel("Add people")
                Button { showCall = true } label: {
                    HStack(spacing: 6) { MacroIcon(name: "phone-call", size: 22); Text("Call").font(.system(size: 14.875)) }.padding(.horizontal, 8.5).frame(height: 42.5)
                }.nativeGlass().accessibilityLabel("Call")
            } else { Spacer() }
        }.buttonStyle(.plain).foregroundStyle(.primary).padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 12)
            .background { LinearGradient(colors: [MacroTheme.background.opacity(0.96), MacroTheme.background.opacity(0)], startPoint: .top, endPoint: .bottom).padding(.bottom, -24).ignoresSafeArea(edges: .top).allowsHitTesting(false) }
    }

    private func beginReply(_ message: ChatMessage) {
        guard store.canCompose(in: channel) else { return }
        editing = nil
        let rootID = message.threadID ?? message.id
        store.expandThread(rootID: rootID)
        if let wire = ReplyTargetContent.wire(for: message) {
            store.setDraft(wire, channelID: ReplyTargetContent.draftKey(channelID: channel.id, rootID: rootID))
        }
        replyRootID = rootID
        Task { await store.loadThread(channelID: channel.id, rootID: rootID) }
    }

    private func viewedLatest(_ date: String) {
        guard store.selectedChannelID == channel.id,
              MessageDate.parse(date) > MessageDate.parse(store.channels.first(where: { $0.id == channel.id })?.viewedAt ?? "") else { return }
        store.markViewed(channelID: channel.id, at: date)
        readTask?.cancel()
        readTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(400))
                let viewed = try await ChatActions(session: session).markRead(channelID: channel.id)
                store.markViewed(channelID: channel.id, at: viewed)
            } catch { }
        }
    }
    private func react(_ message: ChatMessage, emoji: String) async {
        do {
            let selected = message.reactions.first(where: { $0.emoji == emoji })?.users.contains(store.userID) ?? false
            let result = try await ChatActions(session: session).react(message: message, emoji: emoji, add: !selected)
            store.receive(MessageEvent(parent: result.parent, actor: store.userID, change: MessageChange(type: "message_updated", message: result)))
        } catch { actionError = error.localizedDescription }
    }
    private func delete(_ message: ChatMessage) async {
        do {
            let result = try await ChatActions(session: session).delete(message: message)
            store.receive(MessageEvent(parent: result.parent, actor: store.userID, change: MessageChange(type: "message_deleted", message: result)))
        } catch { actionError = error.localizedDescription }
    }

}

struct ConversationActions {
    var isDemo: Bool
    var session: NativeSession
    var store: ChatStore
    var channel: Channel
    var openWeb: () -> Void
    var searchMentions: (String) async -> [MentionCandidate]
    var moreMentions: (String) async -> [MentionCandidate]
    var hasMoreMentions: (String) -> Bool
    var viewed: (String) -> Void
    var attach: () -> Void
    var reply: (ChatMessage) -> Void
    var expand: (ChatMessage) -> Void
    var closeReply: () -> Void
    var menu: (ChatMessage) -> Void
    var react: (ChatMessage, String) -> Void
    var edit: (ChatMessage) -> Void
    var delete: (ChatMessage) -> Void
    var attachment: (MessageAttachment) -> Void
    var agent: (String) -> Void
}

private struct NativeConversation: UIViewControllerRepresentable {
    let store: ChatStore
    let replyRootID: String?
    let editingMessage: ChatMessage?
    let targetMessageID: String?
    let channel: Channel
    let actions: ConversationActions
    @Environment(\.nativeChromeBottom) private var chromeBottom
    @Environment(\.nativeChromeTop) private var chromeTop
    @Environment(\.nativeNavigationDetailVisibleAction) private var navigationDetailVisible

    func makeUIViewController(context: Context) -> ConversationController {
        let controller = ConversationController(store: store, channel: channel, actions: actions)
        controller.onNavigationVisible = navigationDetailVisible
        return controller
    }
    func updateUIViewController(_ controller: ConversationController, context: Context) {
        controller.onNavigationVisible = navigationDetailVisible
        controller.updateChannel(channel)
        controller.setNavigationTarget(targetMessageID)
        controller.updateChromeBottom(chromeBottom)
        controller.updateChromeTop(chromeTop)
        controller.render(messages: store.messages[channel.id] ?? [], replyRootID: replyRootID, editingMessage: editingMessage, pending: store.pending,
                          names: store.names, photos: store.photos, draftAttachments: store.draftAttachments[channel.id] ?? [], deliveryErrors: store.deliveryErrors,
                          hasOlder: store.cursors[channel.id] != nil,
                          loading: store.loadingMessages.contains(channel.id))
    }
}

@MainActor
final class ConversationController: UIViewController, UITextViewDelegate, UITableViewDelegate {
    var onNavigationVisible: () -> Void = {}
    private var appearedBefore = false
    private let store: ChatStore
    private var channel: Channel
    private let actions: ConversationActions
    private let table = AnchoredMessageTable(frame: .zero, style: .plain)
    private let composer = UIView()
    private let composerGlass = UIVisualEffectView()
    private let input = UITextView()
    private let placeholder = UILabel()
    private let sendButton = UIButton(type: .system)
    private let microphoneButton = UIButton(type: .system)
    private let dictation = NativeAgentDictation()
    private var dictationTask: Task<Void, Never>?
    private let attachButton = UIButton(type: .system)
    private let attachmentScroll = UIScrollView()
    private let attachmentStack = UIStackView()
    private var attachmentHeight: NSLayoutConstraint!
    private var currentAttachments: [ChannelDraftAttachment] = []
    private let olderButton = UIButton(type: .system)
    private let latestButton = UIButton(type: .system)
    private let mentionPicker = MentionPickerView()
    private let emptyLabel = UILabel()
    private var inputHeight: NSLayoutConstraint!
    private var composerBottom: NSLayoutConstraint!
    private var chromeBottom: CGFloat = 0
    private var chromeTop: CGFloat = 0
    private var mentionHeight: NSLayoutConstraint!
    private var dataSource: UITableViewDiffableDataSource<Int, String>!
    private var measuredRows: [String: CGSize] = [:]
    private var rendered: [String: ChatMessage] = [:]
    private var timeline: [String: ChannelTimelineEntry] = [:]
    private var replyHost: UIHostingController<InlineThreadReply>?
    private var replyBottom: NSLayoutConstraint?
    private var replyRootID: String?
    private var editingMessage: ChatMessage?
    private var navigationTargetID: String?
    private var navigatedTargetID: String?
    private var revealReplyAfterLayout = false
    private var delivery: [String: DeliveryState] = [:]
    private var photos: [String: URL] = [:]
    private var deliveryErrors: [String: String] = [:]
    private var renderSignatures: [String: String] = [:]
    private var didPosition = false
    private var shouldPinAfterLayout = false
    private var isApplying = false
    private var lastInputWidth: CGFloat = 0
    private var readingAnchor: (id: String, y: CGFloat)?
    private var restoringAnchor = false
    private var followsLatest = true
    private var hasUserScrolled = false
    private var keyboardDragFollowedLatest = false
    private var restoringBottom = false
    private var lastViewedMessageID: String?
    private let openedViewedAt: Date
    private var firstUnreadID: String?
    private var mentionSearchTask: Task<Void, Never>?
    private var mentionSearchQuery: String?
    private var mentionCache: [String: [MentionCandidate]] = [:]

    init(store: ChatStore, channel: Channel, actions: ConversationActions) {
        self.store = store; self.channel = channel; self.actions = actions
        openedViewedAt = MessageDate.parse(channel.viewedAt ?? "")
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MacroTheme.surface
        table.backgroundColor = MacroTheme.surface
        table.separatorStyle = .none
        table.keyboardDismissMode = .interactive
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 105
        // Message/media dimensions are invalidated through the diffable snapshot.
        // UIKit's automatic constraint invalidation animates hosted row heights
        // independently while the table is being dragged.
        table.selfSizingInvalidation = .disabled
        table.delegate = self
        table.afterLayout = { [weak self] in
            guard let self else { return }
            self.rememberVisibleRowHeights()
            self.updateTimelineInsets()
            self.restoreReadingAnchor()
            self.restoreBottomPosition()
            self.reportVisibleLatest()
        }
        table.onAccessibilityScroll = { [weak self] in self?.followsLatest = false; self?.readingAnchor = nil }
        table.contentInsetAdjustmentBehavior = .never
        table.contentInset = UIEdgeInsets(top: 110, left: 0, bottom: 12, right: 0)
        table.register(MeasuredMessageCell.self, forCellReuseIdentifier: "message")
        table.accessibilityIdentifier = "message-timeline"
        emptyLabel.text = "A good place to start a conversation."
        emptyLabel.font = .preferredFont(forTextStyle: .callout)
        emptyLabel.textColor = .secondaryLabel
        emptyLabel.textAlignment = .center
        emptyLabel.numberOfLines = 0
        table.backgroundView = emptyLabel
        olderButton.setTitle("Load earlier messages", for: .normal)
        olderButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        olderButton.addTarget(self, action: #selector(loadOlder), for: .touchUpInside)
        olderButton.accessibilityIdentifier = "load-older"

        composer.backgroundColor = .clear
        if #available(iOS 26, *) { composerGlass.effect = UIGlassEffect(style: .regular) }
        else { composerGlass.effect = UIBlurEffect(style: .systemThinMaterial) }
        composerGlass.layer.cornerRadius = 26
        composerGlass.clipsToBounds = true
        composerGlass.isUserInteractionEnabled = false
        composer.addSubview(composerGlass)
        composerGlass.translatesAutoresizingMaskIntoConstraints = false
        input.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 15.9375))
        input.adjustsFontForContentSizeCategory = true
        input.backgroundColor = .clear
        input.layer.cornerRadius = 21
        input.textContainerInset = UIEdgeInsets(top: 14, left: 3, bottom: 14, right: 3)
        input.isScrollEnabled = false
        input.delegate = self
        input.accessibilityLabel = "Message"
        input.accessibilityIdentifier = "message-input"
        input.isEditable = store.canCompose(in: channel)
        input.keyboardDismissMode = .none
        input.returnKeyType = .default
        input.attributedText = MentionComposer.attributedText(from: store.drafts[channel.id] ?? "")
        input.typingAttributes = MentionComposer.typingAttributes
        placeholder.text = store.canCompose(in: channel) ? "Type @ to share with \(channel.channelType == "direct_message" ? "" : "#")\(store.title(for: channel))" : "Open full channel to join"
        placeholder.font = input.font
        placeholder.textColor = .placeholderText
        placeholder.isUserInteractionEnabled = false
        placeholder.lineBreakMode = .byTruncatingTail
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        input.addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 8),
            placeholder.centerYAnchor.constraint(equalTo: input.centerYAnchor),
            placeholder.widthAnchor.constraint(equalTo: input.widthAnchor, constant: -16)
        ])
        placeholder.isHidden = !input.text.isEmpty

        attachButton.setImage(MacroIcon.image("paperclip", size: 24), for: .normal)
        attachButton.tintColor = .label
        attachButton.accessibilityLabel = "Attach a file"
        attachButton.accessibilityIdentifier = "channel-attach"
        attachButton.addAction(UIAction { [weak self] _ in self?.actions.attach() }, for: .touchUpInside)
        attachmentScroll.showsHorizontalScrollIndicator = false
        attachmentStack.axis = .horizontal; attachmentStack.spacing = 7
        attachmentScroll.addSubview(attachmentStack); attachmentStack.translatesAutoresizingMaskIntoConstraints = false
        attachmentHeight = attachmentScroll.heightAnchor.constraint(equalToConstant: 0)

        var sendConfig = UIButton.Configuration.filled()
        sendConfig.image = MacroIcon.image("arrow-up", size: 24)
        sendConfig.baseBackgroundColor = .label
        sendConfig.baseForegroundColor = MacroTheme.surface
        sendConfig.cornerStyle = .capsule
        sendButton.configuration = sendConfig
        sendButton.accessibilityLabel = "Send message"
        sendButton.accessibilityIdentifier = "send-message"
        sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        microphoneButton.setImage(MacroIcon.image("microphone", size: 24), for: .normal)
        microphoneButton.tintColor = .label
        microphoneButton.accessibilityLabel = "Dictate message"
        microphoneButton.accessibilityIdentifier = "channel-dictation"
        microphoneButton.addTarget(self, action: #selector(toggleDictation), for: .touchUpInside)

        var latestConfig = UIButton.Configuration.borderedProminent()
        latestConfig.title = "New messages"
        latestConfig.image = UIImage(systemName: "arrow.down")
        latestConfig.imagePadding = 7
        latestConfig.cornerStyle = .capsule
        latestButton.configuration = latestConfig
        latestButton.addTarget(self, action: #selector(jumpToLatest), for: .touchUpInside)
        latestButton.isHidden = true
        latestButton.accessibilityIdentifier = "jump-to-latest"
        mentionPicker.isHidden = true
        mentionPicker.onSelect = { [weak self] candidate in
            guard let self, let query = MentionComposer.activeQuery(in: self.input.attributedText, selection: self.input.selectedRange) else { return }
            MentionComposer.insert(candidate, replacing: query, in: self.input)
        }

        [table, mentionPicker, composer, latestButton].forEach { view.addSubview($0); $0.translatesAutoresizingMaskIntoConstraints = false }
        [input, sendButton, microphoneButton, attachButton, attachmentScroll].forEach { composer.addSubview($0); $0.translatesAutoresizingMaskIntoConstraints = false }
        inputHeight = input.heightAnchor.constraint(equalToConstant: 51)
        mentionHeight = mentionPicker.heightAnchor.constraint(equalToConstant: 0)
        composerBottom = composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -chromeBottom)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.topAnchor), table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor), table.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            mentionPicker.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            mentionPicker.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            mentionPicker.bottomAnchor.constraint(equalTo: composer.topAnchor), mentionHeight,
            composer.leadingAnchor.constraint(equalTo: view.leadingAnchor), composer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composerBottom,
            attachmentScroll.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 16),
            attachmentScroll.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -16),
            attachmentScroll.topAnchor.constraint(equalTo: composer.topAnchor, constant: 6), attachmentHeight,
            attachmentStack.topAnchor.constraint(equalTo: attachmentScroll.contentLayoutGuide.topAnchor),
            attachmentStack.bottomAnchor.constraint(equalTo: attachmentScroll.contentLayoutGuide.bottomAnchor),
            attachmentStack.leadingAnchor.constraint(equalTo: attachmentScroll.contentLayoutGuide.leadingAnchor),
            attachmentStack.trailingAnchor.constraint(equalTo: attachmentScroll.contentLayoutGuide.trailingAnchor),
            attachmentStack.heightAnchor.constraint(equalTo: attachmentScroll.frameLayoutGuide.heightAnchor),
            composerGlass.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 12),
            composerGlass.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -12),
            composerGlass.topAnchor.constraint(equalTo: input.topAnchor),
            composerGlass.bottomAnchor.constraint(equalTo: input.bottomAnchor),
            attachButton.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 18),
            attachButton.bottomAnchor.constraint(equalTo: input.bottomAnchor),
            attachButton.widthAnchor.constraint(equalToConstant: 40), attachButton.heightAnchor.constraint(equalToConstant: 51),
            input.leadingAnchor.constraint(equalTo: attachButton.trailingAnchor, constant: 4), input.topAnchor.constraint(equalTo: attachmentScroll.bottomAnchor, constant: 4),
            input.bottomAnchor.constraint(equalTo: composer.bottomAnchor, constant: -10), inputHeight,
            sendButton.leadingAnchor.constraint(equalTo: input.trailingAnchor, constant: 10),
            sendButton.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -16),
            sendButton.bottomAnchor.constraint(equalTo: input.bottomAnchor, constant: -8),
            sendButton.widthAnchor.constraint(equalToConstant: 34), sendButton.heightAnchor.constraint(equalToConstant: 34),
            microphoneButton.centerXAnchor.constraint(equalTo: sendButton.centerXAnchor),
            microphoneButton.centerYAnchor.constraint(equalTo: sendButton.centerYAnchor),
            microphoneButton.widthAnchor.constraint(equalToConstant: 44), microphoneButton.heightAnchor.constraint(equalToConstant: 44),
            latestButton.centerXAnchor.constraint(equalTo: view.centerXAnchor), latestButton.bottomAnchor.constraint(equalTo: composer.topAnchor, constant: -12)
        ])
        dataSource = UITableViewDiffableDataSource<Int, String>(tableView: table) { [weak self] table, path, id in
            let cell = table.dequeueReusableCell(withIdentifier: "message", for: path)
            guard let self, let entry = self.timeline[id] else { return cell }
            (cell as? MeasuredMessageCell)?.representedID = id
            cell.accessibilityIdentifier = "timeline-row-" + id
            cell.selectionStyle = .none
            cell.backgroundColor = .clear
            cell.clipsToBounds = true
            cell.contentView.clipsToBounds = true
            let quote = self.replyRootID.flatMap { self.store.drafts[ReplyTargetContent.draftKey(channelID: self.channel.id, rootID: $0)] }.flatMap { ReplyTargetContent.parse($0).first }
            (cell as? MeasuredMessageCell)?.host(in: self, content:
                ChannelTimelineRow(entry: entry, userID: self.store.userID, names: self.store.names,
                    photos: self.photos, actions: self.actions, showNew: id == self.firstUnreadID,
                    selected: quote?.targetMessageId == entry.message.id || self.navigationTargetID == entry.message.id)
                    // A reused UIKit cell must not carry SwiftUI state or an animated
                    // layout from the message that previously occupied that cell.
                    .id(id)
                    .transaction { transaction in transaction.animation = nil; transaction.disablesAnimations = true }
            )
            return cell
        }
        #if DEBUG
        NativeChannelMotionProbe.install(on: table, composer: composer)
        #endif
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardDidHide), name: UIResponder.keyboardDidHideNotification, object: nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if input.bounds.width > 0 && input.bounds.width != lastInputWidth {
            lastInputWidth = input.bounds.width
            resizeInput()
        }
        updateTimelineInsets()
        restoreReadingAnchor()
        restoreBottomPosition()
        if revealReplyAfterLayout {
            revealInlineReply(); revealReplyAfterLayout = false
        } else if shouldPinAfterLayout {
            if !table.isTracking && !table.isDragging && !table.isDecelerating { scrollToBottom(animated: false) }
            shouldPinAfterLayout = false
        }
    }

    private func updateTimelineInsets() {
        let overlayTop = replyHost?.view.frame.minY ?? (composer.frame.minY - mentionHeight.constant)
        // Begin the system's interactive keyboard dismissal at the top of our
        // floating composer, just as an input accessory moves with the keyboard.
        let dismissPadding = max(0, view.keyboardLayoutGuide.layoutFrame.minY - overlayTop + 12)
        if abs(view.keyboardLayoutGuide.keyboardDismissPadding - dismissPadding) > 0.5 {
            view.keyboardLayoutGuide.keyboardDismissPadding = dismissPadding
        }
        let bottom = max(12, table.bounds.height - overlayTop + 12)
        let clearance = chromeTop + 64
        // Empty space belongs above a short conversation, keeping its latest message by the input.
        let top = max(clearance, table.bounds.height - bottom - table.contentSize.height)
        if abs(table.contentInset.top - top) > 0.5 { table.contentInset.top = top }
        if abs(table.contentInset.bottom - bottom) > 0.5 { table.contentInset.bottom = bottom }
        table.verticalScrollIndicatorInsets = UIEdgeInsets(top: clearance, left: 0, bottom: bottom, right: 0)
    }

    func updateChromeTop(_ top: CGFloat) {
        guard chromeTop != top else { return }; chromeTop = top; view.setNeedsLayout()
    }

    func updateChromeBottom(_ bottom: CGFloat) {
        guard chromeBottom != bottom else { return }
        chromeBottom = bottom
        composerBottom?.constant = -bottom
        replyBottom?.constant = -bottom - 10
        view.setNeedsLayout()
    }

    func updateChannel(_ channel: Channel) {
        self.channel = channel
        guard isViewLoaded else { return }
        input.isEditable = store.canCompose(in: channel)
        attachButton.isEnabled = store.canCompose(in: channel)
        placeholder.text = store.canCompose(in: channel) ? "Type @ to share with \(channel.channelType == "direct_message" ? "" : "#")\(store.title(for: channel))" : "Join from channel details to reply"
    }

    func render(messages: [ChatMessage], replyRootID: String?, editingMessage: ChatMessage?, pending: [String: DeliveryState], names: [String: String], photos: [String: URL], draftAttachments: [ChannelDraftAttachment], deliveryErrors: [String: String], hasOlder: Bool, loading: Bool) {
        loadViewIfNeeded()
        renderAttachments(draftAttachments)
        let openedReply = (replyRootID != nil && self.replyRootID != replyRootID) || (editingMessage != nil && self.editingMessage?.id != editingMessage?.id)
        let closedReply = (self.replyRootID != nil || self.editingMessage != nil) && replyRootID == nil && editingMessage == nil
        self.replyRootID = replyRootID; self.editingMessage = editingMessage
        composer.isHidden = replyRootID != nil || editingMessage != nil
        // Transfer focus before removing the active editor to avoid a keyboard dismissal.
        if closedReply { input.becomeFirstResponder() }
        updateReplyComposer(root: editingMessage ?? messages.first { $0.id == replyRootID })
        if openedReply { hideMentionPicker(); revealReplyAfterLayout = true; followsLatest = false }
        view.setNeedsLayout()
        let wasPinned = !table.isTracking && !table.isDragging && !table.isDecelerating && followsLatest
        let firstVisible = table.indexPathsForVisibleRows?.min()
        let previousFirst = firstVisible.flatMap { dataSource.itemIdentifier(for: $0) }
        let previousY = firstVisible.map { table.rectForRow(at: $0).minY - table.contentOffset.y }
        updateSendControl()
        input.accessibilityHint = store.canCompose(in: channel) ? "Write a message. Return adds a new line." : "Open the full channel to join this conversation."
        emptyLabel.isHidden = !messages.isEmpty
        emptyLabel.text = loading ? "Loading conversation…" : "A good place to start a conversation."
        olderButton.isEnabled = !loading
        updateMentionPicker()
        olderButton.frame = CGRect(x: 0, y: 0, width: table.bounds.width, height: 44)
        if hasOlder && table.tableHeaderView == nil { table.tableHeaderView = olderButton }
        else if !hasOlder && table.tableHeaderView != nil { table.tableHeaderView = nil }
        if !didPosition { firstUnreadID = messages.first { $0.senderID != store.userID && $0.date > openedViewedAt }?.id }
        let entries = ChannelTimelineEntry.make(messages: messages, expanded: store.expandedThreadIDs, replyingTo: replyRootID)
        let oldIDs = Set(timeline.keys)
        let hasNewOwn = entries.contains { !oldIDs.contains($0.id) && pending[$0.id] == .sending }
        let quoteWire = replyRootID.flatMap { store.drafts[ReplyTargetContent.draftKey(channelID: channel.id, rootID: $0)] } ?? ""
        let selectedReplyTargetID = ReplyTargetContent.parse(quoteWire).first?.targetMessageId
        let nextSignatures = Dictionary(uniqueKeysWithValues: entries.map { entry in
            (entry.id, [previewSignature(entry.message, names: names, photos: photos),
                String(entry.grouped), String(entry.firstReply), String(entry.hiddenCount), entry.hiddenParticipants.joined(separator: ","), String(entry.hasReplies),
                pending[entry.message.id]?.rawValue ?? "", deliveryErrors[entry.message.id] ?? "",
                store.loadingThreads.contains(entry.root.id) ? "loading" : "", store.threadErrors[entry.root.id] ?? "",
                String(entry.message.id == selectedReplyTargetID || entry.message.id == navigationTargetID)].joined(separator: "|"))
        })
        let currentIDs = dataSource.snapshot().itemIdentifiers
        let nextIDs = entries.map(\.id)
        guard currentIDs != nextIDs || nextSignatures != renderSignatures else { navigateToTargetIfAvailable(); return }
        let changed = nextIDs.filter { oldIDs.contains($0) && renderSignatures[$0] != nextSignatures[$0] }
        for id in changed { measuredRows.removeValue(forKey: id) }
        let prepending = nextIDs.first != currentIDs.first && !currentIDs.isEmpty
        timeline = Dictionary(uniqueKeysWithValues: entries.map { ($0.id, $0) })
        rendered = Dictionary(uniqueKeysWithValues: entries.map { ($0.id, $0.message) })
        self.photos = photos
        delivery = pending; self.deliveryErrors = deliveryErrors; renderSignatures = nextSignatures
        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0]); snapshot.appendItems(nextIDs); snapshot.reloadItems(changed)
        let pin = !table.isTracking && !table.isDragging && !table.isDecelerating && replyRootID == nil && editingMessage == nil && navigationTargetID == navigatedTargetID && ((!didPosition && !hasUserScrolled) || wasPinned || hasNewOwn)
        if pin { followsLatest = true; readingAnchor = nil }
        else if !table.isDragging && !table.isDecelerating, let first = previousFirst, let y = previousY { readingAnchor = (first, y) }
        isApplying = true
        UIView.performWithoutAnimation {
        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self else { return }
            self.isApplying = false
            self.table.layoutIfNeeded()
            if self.navigateToTargetIfAvailable() { }
            else if openedReply { self.revealInlineReply() }
            else if pin && self.followsLatest && !self.table.isDragging && !self.table.isDecelerating { self.scrollToBottom(animated: false) }
            else if prepending, let first = previousFirst, let y = previousY, let index = self.dataSource.indexPath(for: first) {
                self.readingAnchor = (first, y)
                self.table.scrollToRow(at: index, at: .top, animated: false)
                self.table.layoutIfNeeded()
                self.restoreReadingAnchor()
            } else if messages.contains(where: { !oldIDs.contains($0.id) }) { self.latestButton.isHidden = false }
            if !messages.isEmpty { self.didPosition = true }
        }
        }
    }

    func setNavigationTarget(_ id: String?) { navigationTargetID = id }

    @discardableResult private func navigateToTargetIfAvailable() -> Bool {
        guard let id = navigationTargetID, id != navigatedTargetID, let path = dataSource?.indexPath(for: id) else { return false }
        navigatedTargetID = id; followsLatest = false; readingAnchor = nil
        table.layoutIfNeeded()
        table.scrollToRow(at: path, at: .top, animated: false)
        readingAnchor = (id, table.rectForRow(at: path).minY - table.contentOffset.y)
        latestButton.isHidden = false
        return true
    }

    private func previewSignature(_ message: ChatMessage, names: [String: String], photos: [String: URL]) -> String {
        [message.id, message.updatedAt, message.content, message.deletedAt ?? "", message.editedAt ?? "",
         names[message.senderID] ?? "", message.botProfile?.name ?? "", message.sender?.name ?? "",
         message.botProfile?.avatarURL ?? "", message.sender?.avatarURL ?? "", photos[message.senderID]?.absoluteString ?? "",
         message.attachments.map(\.id).joined(separator: ","),
         message.reactions.map { $0.emoji + $0.users.joined(separator: ",") }.joined(separator: ";")].joined(separator: "|")
    }

    private func renderAttachments(_ attachments: [ChannelDraftAttachment]) {
        guard currentAttachments.map(\.id) != attachments.map(\.id) else { return }
        currentAttachments = attachments
        attachmentStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        attachmentHeight.constant = attachments.isEmpty ? 0 : 36
        for item in attachments {
            var configuration = UIButton.Configuration.tinted()
            configuration.title = String(item.title.prefix(25))
            configuration.image = UIImage(systemName: "xmark.circle.fill")
            configuration.imagePlacement = .trailing; configuration.imagePadding = 8
            configuration.cornerStyle = .capsule
            let chip = UIButton(configuration: configuration)
            chip.accessibilityLabel = "Remove attachment \(item.title)"
            chip.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.store.setDraftAttachments(self.currentAttachments.filter { $0.id != item.id }, channelID: self.channel.id)
            }, for: .touchUpInside)
            attachmentStack.addArrangedSubview(chip)
        }
    }

    private var isNearBottom: Bool {
        guard let last = dataSource?.snapshot().itemIdentifiers.last,
              let path = dataSource?.indexPath(for: last), table.indexPathsForVisibleRows?.contains(path) == true else { return false }
        let bottom = table.rectForRow(at: path).maxY - table.contentOffset.y
        return bottom <= table.bounds.height - table.adjustedContentInset.bottom + 100
    }

    func textViewDidChange(_ textView: UITextView) {
        let pinned = followsLatest
        if textView.markedTextRange == nil { MentionComposer.normalize(textView) }
        store.setDraft(MentionComposer.wireContent(from: textView.attributedText), channelID: channel.id)
        placeholder.isHidden = !textView.text.isEmpty
        resizeInput()
        updateMentionPicker()
        updateSendControl()
        if pinned { shouldPinAfterLayout = true }
    }

    func textViewDidChangeSelection(_ textView: UITextView) { updateMentionPicker() }
    func textViewDidEndEditing(_ textView: UITextView) { hideMentionPicker() }
    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        MentionComposer.shouldChange(textView, range: range, replacement: text)
    }

    private func updateMentionPicker() {
        guard mentionHeight != nil, input.isFirstResponder, input.markedTextRange == nil,
              let query = MentionComposer.activeQuery(in: input.attributedText, selection: input.selectedRange) else {
            hideMentionPicker(); return
        }
        var candidates = MentionCandidate.search(query.query, channel: channel, channels: store.channels,
                                                   names: store.names, currentUserID: store.userID)
        candidates += mentionCache[query.query] ?? []
        let changedQuery = mentionSearchQuery != query.query
        if changedQuery { mentionSearchTask?.cancel(); mentionSearchQuery = query.query }
        if changedQuery && mentionCache[query.query] == nil {
            let text = query.query
            mentionSearchTask = Task { [weak self] in
                do { try await Task.sleep(for: .milliseconds(220)) } catch { return }
                guard let self else { return }
                let results = await self.actions.searchMentions(text)
                guard !Task.isCancelled, self.mentionSearchQuery == text else { return }
                if self.mentionCache.count > 30 { self.mentionCache.removeAll() }
                self.mentionCache[text] = results
                self.updateMentionPicker()
            }
        }
        mentionPicker.onLoadMore = { [weak self] in self?.loadMoreMentions(query.query) }
        mentionPicker.update(candidates: candidates, query: query.query, hasMore: actions.hasMoreMentions(query.query))
        mentionHeight.constant = mentionPicker.intrinsicContentSize.height
        mentionPicker.isHidden = false
        latestButton.isHidden = true
    }

    private func loadMoreMentions(_ query: String) {
        mentionSearchTask?.cancel()
        mentionSearchTask = Task { [weak self] in
            guard let self else { return }
            let results = await self.actions.moreMentions(query)
            guard !Task.isCancelled, self.mentionSearchQuery == query else { return }
            self.mentionCache[query] = results
            self.updateMentionPicker()
        }
    }

    private func hideMentionPicker() {
        mentionSearchTask?.cancel(); mentionSearchQuery = nil
        mentionHeight?.constant = 0
        mentionPicker.isHidden = true
    }

    private func resizeInput() {
        let fitting = input.sizeThatFits(CGSize(width: max(input.bounds.width, 180), height: .greatestFiniteMagnitude))
        let height = min(max(51, fitting.height), 140)
        input.isScrollEnabled = fitting.height > 140
        inputHeight.constant = height
    }

    private func updateSendControl() {
        let hasContent = !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !currentAttachments.isEmpty
        sendButton.isEnabled = store.canCompose(in: channel) && hasContent && !dictation.recording
        sendButton.isHidden = !hasContent || dictation.recording
        microphoneButton.isHidden = hasContent && !dictation.recording
        microphoneButton.isEnabled = store.canCompose(in: channel)
        microphoneButton.tintColor = dictation.recording ? .systemRed : .label
        microphoneButton.accessibilityLabel = dictation.recording ? "Stop dictation" : "Dictate message"
    }

    @objc private func toggleDictation() {
        if dictation.recording { dictationTask?.cancel(); dictation.stop(); updateSendControl(); return }
        if actions.isDemo {
            let alert = UIAlertController(title: "Dictation preview", message: "Microphone dictation is available when signed in.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default)); present(alert, animated: true); return
        }
        let wire = MentionComposer.wireContent(from: input.attributedText)
        let prefix = wire + (wire.isEmpty || wire.last?.isWhitespace == true ? "" : " ")
        dictationTask = Task { [weak self] in
            guard let self else { return }
            await self.dictation.start { [weak self] text in
                guard let self else { return }
                self.input.attributedText = MentionComposer.attributedText(from: prefix + text)
                self.input.selectedRange = NSRange(location: self.input.attributedText.length, length: 0)
                self.textViewDidChange(self.input)
            }
            self.observeDictation()
            if let error = self.dictation.error, self.view.window != nil {
                let alert = UIAlertController(title: "Couldn't start dictation", message: error, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default)); self.present(alert, animated: true)
            }
        }
    }

    private func observeDictation() {
        withObservationTracking { updateSendControl() } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.observeDictation() }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NativeNavigationBackGestures.enable(in: self)
        onNavigationVisible()
        if appearedBefore, store.selectedChannelID == nil {
            Task { @MainActor [weak self] in
                guard let self, self.view.window != nil,
                      self.store.selectedChannelID == nil,
                      !self.store.isChannelInaccessible(self.channel.id) else { return }
                await self.store.open(self.channel)
            }
        }
        appearedBefore = true
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        dictationTask?.cancel(); dictation.stop()
    }

    @objc private func send() {
        guard store.canCompose(in: channel), store.send(MentionComposer.wireContent(from: input.attributedText), channelID: channel.id, attachments: currentAttachments.map(\.attachment)) != nil else { return }
        input.attributedText = NSAttributedString(string: "", attributes: MentionComposer.typingAttributes)
        input.typingAttributes = MentionComposer.typingAttributes
        renderAttachments([])
        placeholder.isHidden = false; resizeInput(); hideMentionPicker(); updateSendControl()
        shouldPinAfterLayout = true
        // A native button does not steal first responder from the UITextView.
        input.becomeFirstResponder()
        UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.5)
    }
    @objc private func loadOlder() { Task { await store.loadOlder(channel.id) } }
    @objc private func jumpToLatest() { scrollToBottom(animated: !UIAccessibility.isReduceMotionEnabled) }
    @objc private func keyboardWillChange() {
        // Interactive dismissal is driven by the keyboard layout guide. Repositioning
        // a row while the finger is tracking would fight that gesture.
        guard !table.isTracking && !table.isDragging && !table.isDecelerating else { return }
        if replyRootID != nil || editingMessage != nil { revealReplyAfterLayout = true }
        else if followsLatest { shouldPinAfterLayout = true }
    }
    @objc private func keyboardDidHide() {
        // SwiftUI restores the dock in this notification turn. Settle only a
        // dismissal that began at the latest message, never an ordinary scroll.
        DispatchQueue.main.async { [weak self] in self?.settleKeyboardDismissal() }
    }
    private func settleKeyboardDismissal() {
        guard keyboardDragFollowedLatest, !table.isTracking, !table.isDragging, !table.isDecelerating,
              view.keyboardLayoutGuide.layoutFrame.minY >= view.bounds.height - 40 else { return }
        keyboardDragFollowedLatest = false
        let bottom = max(-table.adjustedContentInset.top, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        let chromeClearance = composer.bounds.height + chromeBottom + 12
        guard abs(bottom - table.contentOffset.y) <= chromeClearance else { return }
        followsLatest = true; readingAnchor = nil; shouldPinAfterLayout = true
        view.setNeedsLayout()
    }
    private func updateReplyComposer(root: ChatMessage?) {
        guard let root else {
            if let host = replyHost {
                host.willMove(toParent: nil); host.view.removeFromSuperview(); host.removeFromParent()
                replyHost = nil; replyBottom = nil
            }
            return
        }
        if replyHost?.rootView.root.id == root.id && replyHost?.rootView.editing?.id == editingMessage?.id { return }
        if let old = replyHost { old.willMove(toParent: nil); old.view.removeFromSuperview(); old.removeFromParent() }
        let host = UIHostingController(rootView: InlineThreadReply(root: root, editing: editingMessage, channel: channel, store: store, session: actions.session, onClose: actions.closeReply))
        host.sizingOptions = .intrinsicContentSize
        host.safeAreaRegions = []
        host.view.backgroundColor = .clear
        addChild(host); view.addSubview(host.view); host.didMove(toParent: self)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        let bottom = host.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -chromeBottom - 10)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12), bottom
        ])
        replyHost = host; replyBottom = bottom
    }
    private func revealInlineReply() {
        guard let rootID = replyRootID ?? editingMessage?.id else { return }
        let quote = store.drafts[ReplyTargetContent.draftKey(channelID: channel.id, rootID: rootID)].flatMap { ReplyTargetContent.parse($0).first }
        let target = quote?.targetMessageId ?? rootID
        guard let index = dataSource.indexPath(for: target) else { return }
        readingAnchor = nil; followsLatest = false
        table.scrollToRow(at: index, at: .bottom, animated: false)
        latestButton.isHidden = true
    }
    private func scrollToBottom(animated: Bool) {
        readingAnchor = nil
        followsLatest = true
        guard let last = dataSource.snapshot().itemIdentifiers.last, let index = dataSource.indexPath(for: last) else { return }
        table.scrollToRow(at: index, at: .bottom, animated: animated)
        latestButton.isHidden = true
    }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if !isApplying && isNearBottom { latestButton.isHidden = true }
    }
    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        let bottom = max(-table.adjustedContentInset.top, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        keyboardDragFollowedLatest = view.keyboardLayoutGuide.layoutFrame.minY < view.bounds.height - 80 && abs(bottom - table.contentOffset.y) <= 2
        readingAnchor = nil; followsLatest = false; hasUserScrolled = true
        shouldPinAfterLayout = false; revealReplyAfterLayout = false
    }
    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { finishedScrolling() } }
    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { finishedScrolling() }

    private func finishedScrolling() {
        let bottom = max(-table.adjustedContentInset.top, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        followsLatest = abs(table.contentOffset.y - bottom) <= 2
        if !followsLatest, let path = table.indexPathsForVisibleRows?.min(), let id = dataSource.itemIdentifier(for: path) {
            readingAnchor = (id, table.rectForRow(at: path).minY - table.contentOffset.y)
        }
        settleKeyboardDismissal()
    }
    private func rememberVisibleRowHeights() {
        for case let cell as MeasuredMessageCell in table.visibleCells {
            if let id = cell.representedID, cell.bounds.height > 0 { measuredRows[id] = cell.bounds.size }
        }
        if measuredRows.count > 2_000 { measuredRows = measuredRows.filter { timeline[$0.key] != nil } }
    }
    func tableView(_ tableView: UITableView, estimatedHeightForRowAt indexPath: IndexPath) -> CGFloat {
        guard let id = dataSource?.itemIdentifier(for: indexPath) else { return 105 }
        if let size = measuredRows[id], abs(size.width - tableView.bounds.width) < 1 { return size.height }
        return timeline[id]?.kind == .footer ? 56 : 105
    }
    func tableView(_ tableView: UITableView, didEndDisplaying cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        if let cell = cell as? MeasuredMessageCell, let id = cell.representedID, cell.bounds.height > 0 { measuredRows[id] = cell.bounds.size }
    }

    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool { followsLatest = false; readingAnchor = nil; return true }

    private func reportVisibleLatest() {
        guard didPosition, !isApplying, !table.isDragging,
              let id = followsLatest ? dataSource?.snapshot().itemIdentifiers.last : nil,
              let entry = timeline[id], delivery[entry.message.id] == nil,
              let path = dataSource.indexPath(for: id) else { return }
        let rowBottom = table.rectForRow(at: path).maxY - table.contentOffset.y
        let visibleBottom = table.bounds.height - table.adjustedContentInset.bottom
        guard rowBottom <= visibleBottom + 2, rowBottom > table.adjustedContentInset.top else { return }
        let message = entry.kind == .footer ? (entry.root.thread?.preview ?? []).prefix(entry.hiddenCount > 0 ? 3 : Int.max).last ?? entry.root : entry.message
        let date = message.createdAt
        let key = id + ":" + date
        guard key != lastViewedMessageID else { return }
        lastViewedMessageID = key
        let viewed = actions.viewed
        // SwiftUI state must not be mutated during a hosting cell's layout transaction.
        DispatchQueue.main.async { viewed(date) }
    }

    private func restoreBottomPosition() {
        guard followsLatest, didPosition, !isApplying, !restoringBottom, !table.isTracking, !table.isDragging, !table.isDecelerating else { return }
        let bottom = max(-table.adjustedContentInset.top, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        guard abs(table.contentOffset.y - bottom) > 0.5 else { return }
        restoringBottom = true
        table.setContentOffset(CGPoint(x: 0, y: bottom), animated: false)
        latestButton.isHidden = true
        restoringBottom = false
    }

    private func restoreReadingAnchor() {
        guard !restoringAnchor, !isApplying, !table.isTracking, !table.isDragging, !table.isDecelerating, let anchor = readingAnchor,
              let path = dataSource?.indexPath(for: anchor.id) else { return }
        let y = table.rectForRow(at: path).minY - anchor.y
        guard abs(table.contentOffset.y - y) > 0.5 else { return }
        restoringAnchor = true
        table.setContentOffset(CGPoint(x: 0, y: y), animated: false)
        restoringAnchor = false
    }
}

private final class MeasuredMessageCell: UITableViewCell {
    var representedID: String?
    private var hosting: UIHostingController<AnyView>?

    func host<Content: View>(in owner: UIViewController, content: Content) {
        let root = AnyView(content)
        if let hosting {
            hosting.rootView = root
        } else {
            let controller = UIHostingController(rootView: root)
            // The conversation extends under the floating chrome, but a message
            // must never inherit the screen's safe-area padding in its fitting size.
            controller.safeAreaRegions = []
            controller.view.backgroundColor = .clear
            owner.addChild(controller)
            contentView.addSubview(controller.view)
            controller.view.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                controller.view.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
                controller.view.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
                controller.view.topAnchor.constraint(equalTo: contentView.topAnchor),
                controller.view.bottomAnchor.constraint(equalTo: contentView.bottomAnchor)
            ])
            controller.didMove(toParent: owner)
            hosting = controller
        }
        hosting?.view.invalidateIntrinsicContentSize()
    }

    override func systemLayoutSizeFitting(_ targetSize: CGSize, withHorizontalFittingPriority horizontalFittingPriority: UILayoutPriority,
                                         verticalFittingPriority: UILayoutPriority) -> CGSize {
        guard let hosting else { return super.systemLayoutSizeFitting(targetSize, withHorizontalFittingPriority: horizontalFittingPriority, verticalFittingPriority: verticalFittingPriority) }
        let width = targetSize.width > 0 ? targetSize.width : bounds.width
        let size = hosting.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
        let scale = traitCollection.displayScale
        return CGSize(width: width, height: ceil(size.height * scale) / scale)
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        representedID = nil
        hosting?.rootView = AnyView(EmptyView())
    }
}

private final class AnchoredMessageTable: UITableView {
    var afterLayout: (() -> Void)?
    var onAccessibilityScroll: (() -> Void)?
    override func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
        onAccessibilityScroll?()
        return super.accessibilityScroll(direction)
    }
    override func layoutSubviews() {
        UIView.performWithoutAnimation { super.layoutSubviews() }
        afterLayout?()
    }
}
