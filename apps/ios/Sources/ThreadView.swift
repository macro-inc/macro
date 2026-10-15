import SwiftUI
import UIKit

struct NativeThreadView: View {
    let session: NativeSession
    let store: ChatStore
    let channel: Channel
    @State private var model: NativeThreadStore
    @State private var composerHeight: CGFloat = 54
    @State private var editing: ChatMessage?
    @State private var editingText = ""
    @State private var editingHeight: CGFloat = 54
    @State private var deleting: ChatMessage?
    @State private var scrollToLatest = 0
    @State private var atBottom = true
    @Environment(\.dismiss) private var dismiss

    init(session: NativeSession, store: ChatStore, channel: Channel, parent: ChatMessage) {
        self.session = session; self.store = store; self.channel = channel
        _model = State(initialValue: NativeThreadStore(actions: ChatActions(session: session), chat: store, parent: parent))
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        if let root = model.root { messageView(root) }
                        HStack {
                            Text("\(model.replies.count) repl\(model.replies.count == 1 ? "y" : "ies")").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Rectangle().fill(.separator).frame(height: 0.5)
                        }
                        if model.loading && model.replies.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                        ForEach(model.replies) { message in messageView(message) }
                        Color.clear.frame(height: 1).id("thread-bottom")
                            .onAppear { atBottom = true }.onDisappear { atBottom = false }
                    }.padding(16)
                }
                .accessibilityIdentifier("thread-timeline")
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await model.refresh() }
                .onChange(of: scrollToLatest) { _, _ in
                    withAnimation(.easeOut(duration: 0.16)) { proxy.scrollTo("thread-bottom", anchor: .bottom) }
                }
                .onChange(of: model.replies.count) { _, _ in
                    if atBottom { proxy.scrollTo("thread-bottom", anchor: .bottom) }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    VStack(spacing: 4) {
                        if let error = model.error {
                            HStack(spacing: 8) {
                                Text(error).font(.caption).foregroundStyle(.secondary)
                                Button("Retry") { Task { await model.refresh() } }.font(.caption.weight(.semibold))
                            }.padding(.horizontal, 14).padding(.top, 8)
                        }
                        NativeMentionEditor(wire: Binding(get: { model.draft }, set: { model.draft = $0 }),
                            height: $composerHeight, channel: channel, store: store, session: session) {
                            if model.send() != nil { scrollToLatest += 1 }
                        }
                        .disabled(model.isInaccessible)
                        .frame(height: composerHeight)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                    }.background(.bar)
                }
            }
            .navigationTitle("Thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await model.start() }
            .onDisappear { model.stop() }
            .sheet(item: $editing) { message in
                NavigationStack {
                    VStack {
                        NativeMentionEditor(wire: $editingText, height: $editingHeight, channel: channel, store: store, session: session)
                            .frame(height: editingHeight).padding()
                        Spacer()
                    }
                    .navigationTitle("Edit message").navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editing = nil } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Save") {
                                let content = editingText; editing = nil
                                Task { await model.edit(message, content: content) }
                            }.disabled(editingText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }.presentationDetents([.medium, .large])
            }
            .confirmationDialog("Delete this message?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                if let message = deleting {
                    Button("Delete message", role: .destructive) { deleting = nil; Task { await model.delete(message) } }
                }
            }
        }
    }

    private func messageView(_ message: ChatMessage) -> some View {
        let own = message.senderID == store.userID
        let author = message.botProfile?.name ?? message.sender?.name ?? store.name(for: message.senderID)
        return HStack(alignment: .top, spacing: 10) {
            AvatarView(name: author, size: 30,
                photoURL: (message.botProfile?.avatarURL ?? message.sender?.avatarURL).flatMap(URL.init(string:)) ?? store.photos[message.senderID])
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(author).fontWeight(.semibold)
                    Text(message.date, style: .time).foregroundStyle(.secondary)
                    if message.editedAt != nil { Text("edited").foregroundStyle(.tertiary) }
                }.font(.caption)
                Text(message.isDeleted ? "Message deleted" : MentionCodec.displayText(in: message.content))
                    .font(.body).foregroundStyle(message.isDeleted ? .secondary : .primary)
                    .textSelection(.enabled)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(own ? MacroTheme.accent.opacity(0.10) : Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
                if !message.attachments.isEmpty { Label("\(message.attachments.count) attachments", systemImage: "paperclip").font(.caption).foregroundStyle(.secondary) }
                if !message.reactions.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(message.reactions, id: \.emoji) { reaction in
                            Button("\(reaction.emoji) \(reaction.users.count)") { Task { await model.react(message, emoji: reaction.emoji) } }
                                .font(.caption).padding(.horizontal, 8).padding(.vertical, 5)
                                .background(reaction.users.contains(store.userID) ? MacroTheme.accent.opacity(0.15) : Color(uiColor: .tertiarySystemBackground), in: Capsule())
                                .accessibilityIdentifier("thread-reaction-\(message.id)-\(reaction.emoji)")
                        }
                    }
                }
                if model.pending[message.id] == .sending { Text("Sending…").font(.caption2).foregroundStyle(.secondary) }
                else if model.pending[message.id] == .failed {
                    Button("Not sent · tap to retry") { model.retry(message) }.font(.caption).tint(.red)
                        .accessibilityIdentifier("thread-retry-\(message.id)")
                    if let error = model.errors[message.id] { Text(error).font(.caption2).foregroundStyle(.secondary) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread-message-\(message.id)")
        .contextMenu {
            if !message.isDeleted {
                Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = MentionCodec.displayText(in: message.content) }
                if model.pending[message.id] == nil {
                    ForEach(["👍", "❤️", "😂", "🎉", "👀"], id: \.self) { emoji in
                        Button(emoji) { Task { await model.react(message, emoji: emoji) } }
                    }
                    if own {
                        Button("Edit", systemImage: "pencil") { editingText = message.content; editing = message }
                        Button("Delete", systemImage: "trash", role: .destructive) { deleting = message }
                    }
                }
            }
        }
    }
}

/// The same attributed mention tokens and picker as the main conversation, hosted in SwiftUI.
struct NativeMentionEditor: UIViewRepresentable {
    @Binding var wire: String
    @Binding var height: CGFloat
    let channel: Channel
    let store: ChatStore?
    var session: NativeSession? = nil
    var plain = false
    var includeGroups = true
    var accessibilityID = "thread-reply-input"
    var autoFocus = false
    var compact = false
    var focusRequest = 0
    var minimumHeight: CGFloat = 0
    var maximumHeight: CGFloat = 140
    var onFocusChange: ((Bool) -> Void)? = nil
    var onSend: (() -> Void)? = nil

    func makeUIView(context: Context) -> ThreadComposerView {
        let view = ThreadComposerView()
        if let session { view.searchService = MentionSearchService(session: session) }
        return view
    }
    func updateUIView(_ view: ThreadComposerView, context: Context) {
        view.onChange = { wire = $0 }
        view.onHeight = { new in if abs(height - new) > 1 { DispatchQueue.main.async { height = new } } }
        view.onSend = onSend
        view.onFocusChange = onFocusChange
        view.configure(plain: plain, accessibilityID: accessibilityID, compact: compact)
        view.setHeightRange(minimum: minimumHeight, maximum: maximumHeight)
        view.setSendVisible(onSend != nil)
        view.candidates = { query in
            guard let store else { return [] }
            return MentionCandidate.search(query, channel: channel, channels: store.channels, names: store.names, currentUserID: store.userID, includeGroups: includeGroups)
        }
        view.setWire(wire)
        view.setAutoFocus(autoFocus)
        view.requestFocus(focusRequest)
    }
}

final class ThreadComposerView: UIView, UITextViewDelegate {
    var onChange: ((String) -> Void)?
    var onHeight: ((CGFloat) -> Void)?
    var onSend: (() -> Void)?
    var onFocusChange: ((Bool) -> Void)?
    var candidates: ((String) -> [MentionCandidate])?
    var searchService: MentionSearchService?
    private var searchTask: Task<Void, Never>?
    private var searchedQuery: String?
    private var remoteCandidates: [String: [MentionCandidate]] = [:]
    private var plain = false
    private var compact = false
    private var lastFocusRequest = 0
    private let input = UITextView()
    private let picker = MentionPickerView()
    private let sendButton = UIButton(type: .system)
    private var pickerTracking: CADisplayLink?
    private lazy var pickerTracker = MentionOverlayTracker(owner: self)
    private var inputHeight: NSLayoutConstraint!
    private var sendWidth: NSLayoutConstraint!
    private var appliedFont: UIFont?
    private var measurementDirty = true
    private var minimumHeight: CGFloat = 0
    private var maximumHeight: CGFloat = 140
    private var measuredWidth: CGFloat = 0
    private var reportedHeight: CGFloat?
    private var isMeasuring = false
    private var wantsAutoFocus = false
    private var didAutoFocus = false
    private var focusScheduled = false

    init() {
        super.init(frame: .zero)
        input.delegate = self
        let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 15.9375))
        input.font = font; appliedFont = font
        input.backgroundColor = .secondarySystemBackground; input.layer.cornerRadius = 16
        input.textContainerInset = UIEdgeInsets(top: 11, left: 8, bottom: 11, right: 8)
        input.accessibilityLabel = "Reply"; input.accessibilityIdentifier = "thread-reply-input"
        input.typingAttributes = MentionComposer.typingAttributes
        sendButton.setImage(UIImage(systemName: "arrow.up.circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 33, weight: .semibold)), for: .normal)
        sendButton.accessibilityLabel = "Send reply"; sendButton.accessibilityIdentifier = "thread-send"
        sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        picker.isHidden = true
        picker.onLoadMore = { [weak self] in self?.loadMoreMentions() }
        picker.onSelect = { [weak self] candidate in
            guard let self, let query = MentionComposer.activeQuery(in: input.attributedText, selection: input.selectedRange) else { return }
            MentionComposer.insert(candidate, replacing: query, in: input)
        }
        for view in [input, sendButton] { addSubview(view); view.translatesAutoresizingMaskIntoConstraints = false }
        inputHeight = input.heightAnchor.constraint(equalToConstant: 46)
        sendWidth = sendButton.widthAnchor.constraint(equalToConstant: 44)
        NSLayoutConstraint.activate([
            input.topAnchor.constraint(equalTo: topAnchor, constant: 4), input.leadingAnchor.constraint(equalTo: leadingAnchor),
            input.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -6), inputHeight,
            sendButton.trailingAnchor.constraint(equalTo: trailingAnchor), sendButton.bottomAnchor.constraint(equalTo: input.bottomAnchor),
            sendWidth, sendButton.heightAnchor.constraint(equalToConstant: 46),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setHeightRange(minimum: CGFloat, maximum: CGFloat) {
        let minHeight = max(0, minimum), maxHeight = max(minHeight, maximum)
        guard minimumHeight != minHeight || maximumHeight != maxHeight else { return }
        minimumHeight = minHeight; maximumHeight = maxHeight; measurementDirty = true
    }
    func setAutoFocus(_ enabled: Bool) { wantsAutoFocus = enabled; scheduleAutoFocus() }
    func requestFocus(_ value: Int) {
        guard value != lastFocusRequest else { return }
        lastFocusRequest = value; wantsAutoFocus = true; didAutoFocus = false
        scheduleAutoFocus()
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { hideMentionOverlay() }
        scheduleAutoFocus()
    }
    private func scheduleAutoFocus() {
        guard wantsAutoFocus, !didAutoFocus, !focusScheduled, window != nil else { return }
        focusScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.focusScheduled = false
            guard self.wantsAutoFocus, !self.didAutoFocus, self.window != nil else { return }
            self.didAutoFocus = self.input.becomeFirstResponder()
        }
    }

    func configure(plain: Bool, accessibilityID: String, compact: Bool = false) {
        if self.plain != plain {
            self.plain = plain
            input.backgroundColor = plain ? .clear : .secondarySystemBackground
            input.layer.cornerRadius = plain ? 0 : 16
        }
        if input.accessibilityIdentifier != accessibilityID { input.accessibilityIdentifier = accessibilityID }
        if self.compact != compact {
            self.compact = compact; measurementDirty = true
            input.textContainerInset = compact ? UIEdgeInsets(top: 9, left: 0, bottom: 9, right: 0) : UIEdgeInsets(top: 11, left: 8, bottom: 11, right: 8)
        }
        applyFont()
    }
    private func applyFont() {
        let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 15.9375))
        guard appliedFont != font else { return }
        appliedFont = font; measurementDirty = true
        // Font setters invalidate TextKit layout even when the point size is unchanged.
        // Reapply only for a real Dynamic Type change, preserving token emphasis.
        let existing = NSMutableAttributedString(attributedString: input.attributedText)
        if existing.length > 0, let paragraph = MentionComposer.typingAttributes[.paragraphStyle] {
            existing.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: existing.length))
        }
        existing.enumerateAttribute(.font, in: NSRange(location: 0, length: existing.length)) { value, range, _ in
            let traits = (value as? UIFont)?.fontDescriptor.symbolicTraits ?? []
            let scaled = font.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: font.pointSize) } ?? font
            existing.addAttribute(.font, value: scaled, range: range)
        }
        input.font = font
        if existing.length > 0 { input.attributedText = existing }
        var attributes = MentionComposer.typingAttributes; attributes[.font] = font; input.typingAttributes = attributes
    }
    func setSendVisible(_ visible: Bool) {
        if sendButton.isHidden == visible { sendButton.isHidden = !visible }
        let width: CGFloat = visible ? 44 : 0
        if sendWidth.constant != width { sendWidth.constant = width; measurementDirty = true }
    }

    func setWire(_ wire: String) {
        if input.markedTextRange == nil, MentionComposer.wireContent(from: input.attributedText) != wire {
            input.attributedText = MentionComposer.attributedText(from: wire)
            input.typingAttributes = MentionComposer.typingAttributes
            measurementDirty = true
        }
        let enabled = !wire.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if sendButton.isEnabled != enabled { sendButton.isEnabled = enabled }
        resize()
    }

    override func layoutSubviews() { super.layoutSubviews(); resize(); layoutMentionOverlay() }
    private func resize() {
        guard !isMeasuring else { return }
        isMeasuring = true
        defer { isMeasuring = false }
        let width = input.bounds.width
        if width > 0, measurementDirty || abs(width - measuredWidth) > 0.5 {
            measurementDirty = false; measuredWidth = width
            let measured = input.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
            let height = ceil(min(maximumHeight, max(minimumHeight, compact ? 40 : 46, measured)))
            if inputHeight.constant != height { inputHeight.constant = height }
            let scroll = measured > maximumHeight
            if input.isScrollEnabled != scroll { input.isScrollEnabled = scroll }
        }
        let height = inputHeight.constant + 4
        if reportedHeight != height { reportedHeight = height; onHeight?(height) }
    }

    @objc private func send() { onSend?(); input.becomeFirstResponder() }
    func textViewDidBeginEditing(_ textView: UITextView) { onFocusChange?(true) }
    func textViewDidChange(_ textView: UITextView) {
        if input.markedTextRange == nil { MentionComposer.normalize(input) }
        measurementDirty = true
        onChange?(MentionComposer.wireContent(from: input.attributedText)); updatePicker(); resize()
    }
    func textViewDidChangeSelection(_ textView: UITextView) { updatePicker() }
    func textViewDidEndEditing(_ textView: UITextView) { onFocusChange?(false); searchTask?.cancel(); searchedQuery = nil; hideMentionOverlay() }
    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        MentionComposer.shouldChange(textView, range: range, replacement: text)
    }
    private func updatePicker() {
        guard input.isFirstResponder, input.markedTextRange == nil,
              let query = MentionComposer.activeQuery(in: input.attributedText, selection: input.selectedRange) else {
            searchTask?.cancel(); searchedQuery = nil
            hideMentionOverlay(); return
        }
        if let searchService, searchedQuery != query.query {
            searchTask?.cancel(); searchedQuery = query.query
            let search = query.query
            searchTask = Task { [weak self] in
                if !search.isEmpty { try? await Task.sleep(for: .milliseconds(160)) }
                guard !Task.isCancelled else { return }
                let results = await searchService.search(search)
                guard let self, !Task.isCancelled, self.searchedQuery == search else { return }
                if self.remoteCandidates.count > 40 { self.remoteCandidates.removeAll() }
                self.remoteCandidates[search] = results; self.updatePicker()
            }
        }
        picker.update(candidates: (candidates?(query.query) ?? []) + (remoteCandidates[query.query] ?? []), query: query.query,
                      hasMore: searchService?.hasMore(query.query) ?? false)
        showMentionOverlay()
    }
    private func showMentionOverlay() {
        guard let window else { return }
        if picker.superview !== window { picker.removeFromSuperview(); window.addSubview(picker) }
        picker.isHidden = false
        layoutMentionOverlay()
        if pickerTracking == nil {
            let tracking = CADisplayLink(target: pickerTracker, selector: #selector(MentionOverlayTracker.tick(_:)))
            tracking.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
            tracking.add(to: .main, forMode: .common); pickerTracking = tracking
        }
    }
    private func hideMentionOverlay() {
        picker.isHidden = true; picker.removeFromSuperview()
        pickerTracking?.invalidate(); pickerTracking = nil
    }
    fileprivate func layoutMentionOverlay() {
        guard !picker.isHidden, let window, picker.superview === window else { return }
        // A window overlay follows scrolling and interactive keyboard movement without
        // changing the editor's height or allowing a parent glass card to clip taps.
        let anchor = input.convert(input.bounds, to: window)
        let editor = convert(bounds, to: window)
        let bottom = anchor.minY - 8
        let height = picker.fittingHeight(maximum: max(0, bottom - window.safeAreaInsets.top - 8))
        let width = min(editor.width, window.bounds.width - 24)
        let x = min(max(12, editor.minX), window.bounds.width - width - 12)
        let frame = CGRect(x: x, y: bottom - height, width: width, height: height)
        if picker.frame != frame { picker.frame = frame }
    }
    private func loadMoreMentions() {
        guard let query = searchedQuery, let searchService else { return }
        Task { [weak self] in
            let results = await searchService.loadMore(query)
            guard let self, self.searchedQuery == query else { return }
            self.remoteCandidates[query] = results; self.updatePicker()
        }
    }
}

@MainActor private final class MentionOverlayTracker: NSObject {
    weak var owner: ThreadComposerView?
    init(owner: ThreadComposerView) { self.owner = owner }
    @objc func tick(_ link: CADisplayLink) {
        guard let owner else { link.invalidate(); return }
        owner.layoutMentionOverlay()
    }
}
