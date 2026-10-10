import SwiftUI
import UIKit

/// The mobile All search surface. The query and Ask AI islands stay above the keyboard.
struct WorkspaceSearchView: View {
    let session: NativeSession
    let store: ChatStore
    let onOpen: (WorkspaceItem, NativeAgentAPI?) -> Void
    let onCognition: (NativeCognitionStore) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var scope: NativeSearchScope = .all
    @State private var showsFilters = false
    @State private var unreadOnly = false
    @State private var results: [WorkspaceItem] = []
    @State private var recent: [WorkspaceItem] = []
    @State private var recentCursor: String?
    @State private var error: String?
    @State private var loading = false
    @State private var cursor: String?
    @State private var service: WorkspaceService
    @State private var cognition: NativeCognitionStore
    @State private var asking = false
    @State private var submittedQuery: String?
    @State private var selectedResultID: String?

    init(session: NativeSession, store: ChatStore, onOpen: @escaping (WorkspaceItem, NativeAgentAPI?) -> Void, onCognition: @escaping (NativeCognitionStore) -> Void) {
        self.session = session; self.store = store; self.onOpen = onOpen; self.onCognition = onCognition
        _service = State(initialValue: WorkspaceService(session: session))
        _cognition = State(initialValue: NativeCognitionStore(session: session, chat: store, draftKey: "search-ai"))
    }
    private var display: WorkspaceSearchProjection.Result {
        let channels = store.channels.map { channel in
            WorkspaceItem(id: channel.id, kind: .channel, title: store.title(for: channel), subtitle: channel.preview, updatedAt: channel.updatedAt,
                isUnread: channel.hasUnread, entityType: "channel")
        }
        let cached = (recent + channels).filter { (scope.kind == nil || $0.kind == scope.kind) && (!(unreadOnly || scope == .notifications) || $0.isUnread) }
        return WorkspaceSearchProjection.project(query: query, cached: cached, service: results)
    }
    var body: some View {
        let projection = display
        ScrollView {
            LazyVStack(spacing: 0) {
                if let error {
                    Text(error).font(.system(size: 13)).foregroundStyle(.secondary).padding(16).frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(Array(projection.items.enumerated()), id: \.element.id) { index, item in
                    if index == 0 && projection.featuredCount > 0 { sectionHeader("Featured Results") }
                    if index == projection.featuredCount && projection.featuredCount > 0 { sectionHeader("More Results") }
                    Button { open(item) } label: { NativeSearchResultRow(item: item, store: store, query: query, featured: index < projection.featuredCount) }
                        .buttonStyle(NativeListRowButtonStyle(selected: selectedResultID == item.id, leading: 0, trailing: 0))
                        .accessibilityIdentifier("search-result-\(item.id)")
                }
                if loading { ProgressView().padding(24).frame(maxWidth: .infinity) }
                if !loading && projection.items.isEmpty && !query.isEmpty {
                    Text("No results").font(.system(size: 15)).foregroundStyle(.secondary).padding(.top, 28)
                }
                if cursor != nil {
                    Button("Load more results") { Task { await search(more: true) } }
                        .font(.system(size: 13)).disabled(loading).padding(16).accessibilityIdentifier("search-load-more")
                }
            }.padding(.top, 8)
        }
        .accessibilityIdentifier(loading ? "workspace-search-loading" : "workspace-search-ready")
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 12.75) {
                scopeBar
                HStack(spacing: 12) {
                    HStack(spacing: 0) {
                        NativeWorkspaceSearchField(text: $query, disabled: submittedQuery != nil)
                        Button {
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                            dismiss()
                        } label: { MacroIcon(name: "x", size: 16).frame(width: 36, height: 44).contentShape(Rectangle()) }
                            .accessibilityLabel("Close search").accessibilityIdentifier("workspace-search-close")
                    }.padding(.leading, 16).padding(.trailing, 4).frame(height: 46.75).nativeGlass()
                    Button { Task { await askAI() } } label: {
                        Group { if asking { ProgressView() } else { Text("Ask AI").font(.system(size: 12.75, weight: .medium)) } }
                            .foregroundStyle(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.secondary : MacroTheme.background)
                            .padding(.horizontal, 14).frame(height: 46.75)
                            .background(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.clear : MacroTheme.accent, in: Capsule())
                    }.disabled(asking || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .nativeGlass().accessibilityIdentifier("search-ask-ai")
                }.buttonStyle(.plain)
            }.padding(.horizontal, 12).padding(.top, 17).padding(.bottom, 12.75)
                .background { LinearGradient(colors: [MacroTheme.background.opacity(0), MacroTheme.background.opacity(0.9)], startPoint: .top, endPoint: .bottom).ignoresSafeArea(edges: .bottom) }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                Button { showsFilters = true } label: { MacroIcon(name: "sliders-horizontal", size: 21.25).frame(width: 42.5, height: 42.5) }
                    .buttonStyle(.plain).nativeGlass().accessibilityLabel("Search filters").accessibilityIdentifier("search-filters")
                Spacer()
            }.padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 12.75)
        }
        .fullScreenCover(isPresented: $showsFilters) {
            NativeFloatingDrawer(onDismiss: { showsFilters = false }) {
                VStack(alignment: .leading, spacing: 17) {
                    HStack { Text("Search filters").font(.system(size: 19, weight: .medium)); Spacer(); Button { showsFilters = false } label: { MacroIcon(name: "x", size: 17) } }
                    Toggle("Unread only", isOn: $unreadOnly).font(.system(size: 16)).tint(MacroTheme.accent)
                    Button("Clear all") { unreadOnly = false; scope = .all }.foregroundStyle(.red)
                }.padding(.horizontal, 25.5).padding(.bottom, 34)
            }.presentationBackground(.clear)
        }
        .background(MacroTheme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { selectedResultID = nil }
        .task(id: query + "|" + scope.rawValue + "|" + String(unreadOnly)) {
            cursor = nil; error = nil
            if query.count >= 3 { results = []; loading = true; try? await Task.sleep(for: .milliseconds(180)) }
            guard !Task.isCancelled else { return }
            await search()
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title).font(.system(size: 12.75, weight: .semibold)).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8.5).padding(.vertical, 6.375)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8.5)).padding(.horizontal, 4.25).padding(.vertical, 2.125)
    }
    private var scopeBar: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8.5) {
                    ForEach(NativeSearchScope.allCases) { choice in
                        Button { scope = choice } label: {
                            Group {
                                if let icon = choice.icon { MacroIcon(name: icon, size: 21.25).frame(width: 42.5) }
                                else { Text(choice.rawValue).font(.system(size: 12.75, weight: .medium)).padding(.horizontal, 14.875) }
                            }.frame(height: 42.5).foregroundStyle(scope == choice ? MacroTheme.background : Color.secondary)
                                .background(scope == choice ? MacroTheme.accent : Color.clear, in: Capsule())
                        }.buttonStyle(.plain).nativeGlass().id(choice)
                            .accessibilityLabel(choice.rawValue).accessibilityIdentifier("search-scope-\(choice.rawValue.lowercased())")
                            .accessibilityAddTraits(scope == choice ? .isSelected : [])
                    }
                }
            }.onChange(of: scope) { _, selected in withAnimation(.easeOut(duration: 0.18)) { reader.scrollTo(selected, anchor: .center) } }
        }
    }
    private func search(more: Bool = false) async {
        let requested = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let requestedScope = scope
        let priorCursor = more ? cursor : nil
        loading = true
        do {
            let page: WorkspacePage
            if requested.count >= 3 { page = try await service.search(requested, cursor: priorCursor, kind: requestedScope.kind) }
            else if more || recent.isEmpty {
                page = try await service.allEntityRecents(cursor: priorCursor)
                if !more { recent = page.items; recentCursor = page.nextCursor }
            } else { page = WorkspacePage(items: recent, nextCursor: recentCursor) }
            guard !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == requested, scope == requestedScope else { return }
            var items = requested.count < 3 && !requested.isEmpty ? page.items.filter { ($0.title + " " + $0.preview).localizedCaseInsensitiveContains(requested) } : page.items
            items = items.filter { (!(unreadOnly || requestedScope == .notifications) || $0.isUnread) && (requestedScope.kind == nil || $0.kind == requestedScope.kind) }
            if more { var ids = Set(results.map(\.id)); results += items.filter { ids.insert($0.id).inserted } }
            else { results = items }
            cursor = page.nextCursor == priorCursor ? nil : page.nextCursor
            loading = false
        } catch {
            if !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == requested { self.error = error.localizedDescription; loading = false }
        }
    }
    private func open(_ item: WorkspaceItem) {
        selectedResultID = item.id
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        onOpen(item, nil)
    }
    private func askAI() async {
        guard !asking else { return }
        let prompt = submittedQuery ?? query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        submittedQuery = prompt; asking = true; error = nil
        defer { asking = false }
        await cognition.start()
        if await cognition.send(content: prompt, attachments: []) { onCognition(cognition) }
        else { error = cognition.error ?? "Your message could not be sent. Please try again." }
    }
}

private enum NativeSearchScope: String, CaseIterable, Identifiable {
    case all = "All", notifications = "Notifications", calendar = "Calendar", email = "Email", channels = "Channels", files = "Files", agents = "Agents", tasks = "Tasks", calls = "Calls"
    var id: String { rawValue }
    var icon: String? { switch self { case .notifications: "bell"; case .calendar: "calendar"; default: nil } }
    var kind: WorkspaceKind? {
        switch self { case .all, .notifications: nil; case .calendar: .calendar; case .email: .email; case .channels: .channel; case .files: .document; case .agents: .agent; case .tasks: .task; case .calls: .call }
    }
}

private struct NativeSearchResultRow: View {
    let item: WorkspaceItem
    let store: ChatStore
    var query: String
    var featured: Bool
    var body: some View {
        let display = item.rowDisplay(currentUserID: store.userID, names: store.names, channels: store.channels)
        HStack(spacing: 8.5) {
            MacroIcon(name: item.iconName, size: 18).foregroundStyle(item.kind == .agent ? .cyan : item.kind == .task ? .green : .secondary).frame(width: 25.5, height: 25.5)
            Text(highlight(item.kind == .email ? item.title : display.title)).font(.system(size: 14.875, weight: .medium)).lineLimit(1)
                .layoutPriority(1)
            if !featured && !display.preview.isEmpty { Text(display.preview).font(.system(size: 12.75)).foregroundStyle(.secondary).lineLimit(1) }
            Spacer(minLength: 0)
            if !featured && item.date > .distantPast { Text(NativeTimestamp.label(item.date)).font(.system(size: 12.75)).foregroundStyle(.secondary).lineLimit(1) }
        }.frame(minHeight: 47).padding(.horizontal, 25.5).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
    }
    private func highlight(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !needle.isEmpty, let range = result.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) {
            result[range].foregroundColor = MacroTheme.accent
            result[range].backgroundColor = MacroTheme.accent.opacity(0.15)
        }
        return result
    }
}

private struct NativeWorkspaceSearchField: UIViewRepresentable {
    @Binding var text: String
    var disabled: Bool
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> Field {
        let field = Field()
        field.font = UIFont.systemFont(ofSize: 15.9375); field.textColor = .label
        field.backgroundColor = .clear; field.background = UIImage(); field.borderStyle = .none
        field.leftView = nil; field.clearButtonMode = .never
        field.placeholder = "Search or ask AI..."; field.returnKeyType = .search
        field.autocorrectionType = .no; field.autocapitalizationType = .none
        field.accessibilityLabel = "Search or ask AI"; field.accessibilityIdentifier = "workspace-search-input"
        field.accessibilityTraits.insert(.searchField)
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return field
    }
    func updateUIView(_ field: Field, context: Context) {
        context.coordinator.parent = self
        if field.text != text { field.text = text }
        field.isEnabled = !disabled
    }
    final class Field: UISearchTextField {
        private var hasRequestedFocus = false
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil, !hasRequestedFocus else { return }; hasRequestedFocus = true
            DispatchQueue.main.async { [weak self] in self?.becomeFirstResponder() }
        }
    }
    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: NativeWorkspaceSearchField
        init(_ parent: NativeWorkspaceSearchField) { self.parent = parent }
        @objc func changed(_ field: UITextField) { parent.text = field.text ?? "" }
        func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return false }
    }
}
