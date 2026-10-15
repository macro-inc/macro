import SwiftUI
import UIKit

enum NativeTab: String, CaseIterable, Identifiable {
    case home, calendar, email, channels, files, agents, tasks, calls
    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: "Notifications"
        case .calendar: "Calendar"
        case .email: "Email"
        case .channels: "Channels"
        case .files: "Files"
        case .agents: "Agents"
        case .tasks: "Tasks"
        case .calls: "Calls"
        }
    }
    var symbol: String {
        switch self {
        case .home: "bell"
        case .calendar: "calendar"
        case .email: "envelope"
        case .channels: "number"
        case .files: "doc.on.doc"
        case .agents: "sparkles"
        case .tasks: "checklist"
        case .calls: "phone"
        }
    }
    var createTitle: String {
        switch self {
        case .calendar: "Event"
        case .email: "Email"
        case .channels: "Message"
        case .files: "Document"
        case .tasks: "Task"
        default: "New"
        }
    }
}

struct WorkspaceShell: View {
    let session: NativeSession
    let store: ChatStore
    @Namespace private var dockSelection
    @State private var dockSelectionMoving = false
    @State private var dockSelectionSettle: Task<Void, Never>?
    @State private var selected: NativeTab
    @State private var visited: Set<NativeTab>
    @State private var resetIDs: [NativeTab: Int] = [:]
    @State private var detailTabs: Set<NativeTab> = []
    @State private var cognitionTabs: Set<NativeTab> = []
    @State private var parkedChannels: [NativeTab: String] = [:]
    @State private var creates: [NativeTab: Int] = [:]
    @State private var showMore = false
    @State private var showSearch = false
    @State private var pendingSearchItem: WorkspaceItem?
    @State private var pendingSearchAPI: NativeAgentAPI?
    @State private var quickCognition: NativeCognitionStore?
    @State private var cognitionOrigin: NativeTab?
    @State private var pendingSearchCognition: NativeCognitionStore?
    @State private var quickAgentFocused = false
    @State private var emailCompositionActive = false
    @State private var quickAgent: WorkspaceItem?
    @State private var quickAgentAPI: NativeAgentAPI?
    @State private var quickAgentOrigin: NativeTab?
    @State private var newAgentOrigin: NativeTab?
    @State private var agentRefreshRequest = 0
    @State private var showAccount = false
    @State private var showCreate = false
    @State private var showChannelCreate = false
    @State private var creatingResource = false
    @State private var createError: String?
    @State private var showCreateMenu = false
    @State private var createTriggerFrame: CGRect = .zero
    @State private var quickAgentFocusRequest = 0
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var webURL: URL?
    @State private var webOrigin: NativeTab?
    @State private var scheduleKind: NativeScheduleKind?
    @State private var keyboardVisible = false

    init(session: NativeSession, store: ChatStore) {
        self.session = session; self.store = store
        let first: NativeTab = ProcessInfo.processInfo.arguments.contains("--ui-testing") && !ProcessInfo.processInfo.arguments.contains("--workspace-testing") ? .channels : .home
        _selected = State(initialValue: first); _visited = State(initialValue: [first])
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
            TabView(selection: $selected) {
                ForEach(NativeTab.allCases.filter { visited.contains($0) }) { tab in
                    NavigationStack {
                        tabContent(tab)
                            .toolbar(.hidden, for: .tabBar)
                            .navigationDestination(isPresented: Binding(get: { quickAgent != nil && quickAgentOrigin == tab }, set: { if !$0 { quickAgent = nil; quickAgentAPI = nil; quickAgentOrigin = nil } })) {
                                if let item = quickAgent {
                                    Group {
                                        if item.kind == .agent { NativeAgentDestination(session: session, item: item, store: store, api: quickAgentAPI) }
                                        else { WorkspaceDestination(item: item, session: session, chat: store) }
                                    }.onAppear { detail(true, tab: tab) }
                                }
                            }
                        .navigationDestination(isPresented: Binding(get: { newAgentOrigin == tab }, set: { if !$0 { newAgentOrigin = nil } })) {
                            NativeAgentCreateView(session: session, store: store).onAppear { detail(true, tab: tab) }
                        }
                        .navigationDestination(isPresented: Binding(get: { quickCognition != nil && cognitionOrigin == tab }, set: { if !$0 { quickCognition = nil; cognitionOrigin = nil } })) {
                            if let model = quickCognition {
                                NativeCognitionDestination(model: model, store: store, session: session)
                                    .onAppear { detail(true, tab: tab) }
                            }
                        }
                        .navigationDestination(isPresented: Binding(get: { webURL != nil && webOrigin == tab }, set: { if !$0 { webURL = nil; webOrigin = nil } })) {
                            if let webURL { WebWorkspaceView(session: session, url: webURL, integratedNavigation: true).onAppear { detail(true, tab: tab) } }
                        }
                    }
                    .onPreferenceChange(NativeCognitionDockPreference.self) { active in
                        if active { cognitionTabs.insert(tab) } else { cognitionTabs.remove(tab) }
                    }
                    .environment(\.nativeNavigationDetailVisibleAction, { detail(true, tab: tab) })
                    .environment(\.nativeChromeTop, geometry.safeAreaInsets.top)
                    .environment(\.nativeChromeBottom, keyboardVisible ? 0 : max(0, (detailTabs.contains(tab) ? 58 : 116) + 16 - geometry.safeAreaInsets.bottom))
                    .id("\(tab.id)-\(resetIDs[tab, default: 0])")
                    .tag(tab)
                }
            }
            .toolbar(.hidden, for: .tabBar)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
                if !keyboardVisible || quickAgentFocused {
                    VStack(spacing: 12) {
                        if !detailTabs.contains(selected) { actionRow }
                        if !keyboardVisible { dock(width: geometry.size.width) }
                    }
                    .padding(.horizontal, 12).padding(.bottom, keyboardVisible ? 8 : 28 - geometry.safeAreaInsets.bottom)
                    .background { LinearGradient(colors: [MacroTheme.background.opacity(0), MacroTheme.background.opacity(0.9)], startPoint: .top, endPoint: .bottom).ignoresSafeArea(edges: .bottom) }
                }
            }
        }
        .blur(radius: showCreateMenu ? 8 : 0)
        .saturation(showCreateMenu ? 1.05 : 1)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: showCreateMenu)
        .coordinateSpace(name: "workspace-shell")
        .onPreferenceChange(NativeCreateTriggerFrame.self) { if $0 != .zero { createTriggerFrame = $0 } }
        .overlay { if showCreateMenu { NativeCreateMenu(triggerFrame: createTriggerFrame, onClose: { showCreateMenu = false }) { tab in
            if let tab { create(tab) } else { showCreate = true }
        } } }
        .background(MacroTheme.background)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in keyboardVisible = false }
        .fullScreenCover(isPresented: $showMore) { moreSheet.presentationBackground(.clear) }
        .fullScreenCover(isPresented: $showAccount) { NativeSettingsView(session: session, store: store).environment(\.nativeChromeBottom, 0).presentationBackground(.clear) }
        .fullScreenCover(isPresented: $showSearch, onDismiss: {
            if let model = pendingSearchCognition {
                quickCognition = model; cognitionOrigin = selected; pendingSearchCognition = nil
            }
            if let item = pendingSearchItem {
                quickAgentAPI = pendingSearchAPI; quickAgentOrigin = selected; quickAgent = item
                if item.kind == .agent { agentRefreshRequest += 1 }
                pendingSearchItem = nil; pendingSearchAPI = nil
            }
        }) {
            WorkspaceSearchView(session: session, store: store, onOpen: { item, api in
                pendingSearchItem = item; pendingSearchAPI = api; showSearch = false
            }, onCognition: { model in
                pendingSearchCognition = model; showSearch = false
            })
        }
        .fullScreenCover(isPresented: $showCreate) { createSheet.presentationBackground(.clear) }
        .fullScreenCover(isPresented: $showChannelCreate) {
            NativeChannelCreateDrawer(session: session, store: store) { channel in
                showChannelCreate = false
                quickAgentOrigin = selected
                quickAgent = WorkspaceItem(id: channel.id, kind: .channel, title: store.title(for: channel), channelID: channel.id, entityType: "channel")
            }.presentationBackground(.clear)
        }
        .overlay { if creatingResource { ProgressView("Creating…").padding(20).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) } }
        .alert("Couldn’t create item", isPresented: Binding(get: { createError != nil }, set: { if !$0 { createError = nil } })) { Button("OK") { createError = nil } } message: { Text(createError ?? "") }
        .fullScreenCover(item: $scheduleKind) { kind in
            NativeScheduleComposer(kind: kind, session: session, store: store, onClose: { scheduleKind = nil }) { id in
                scheduleKind = nil
                if kind == .automation {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { webOrigin = selected; webURL = session.environment.webURL.appendingPathComponent("automation/" + id) }
                }
            }.presentationBackground(.clear)
        }
        .task { await store.start() }
    }

    @ViewBuilder private func tabContent(_ tab: NativeTab) -> some View {
        switch tab {
        case .channels:
            NativeChannelList(session: session, store: store, createRequest: creates[tab, default: 0], onDetailChange: { detail($0, tab: tab) })
        case .email:
            EmailWorkspaceView(session: session, chat: store, createRequest: creates[tab, default: 0], onComposeChange: { emailCompositionActive = $0 }, onDetailChange: { detail($0, tab: tab) })
        case .calendar:
            CalendarWorkspaceView(session: session, createRequest: creates[tab, default: 0], onDetailChange: { detail($0, tab: tab) })
        default:
            WorkspaceResourceView(tab: tab, session: session, chat: store, createRequest: creates[tab, default: 0], refreshRequest: tab == .agents ? agentRefreshRequest : 0, onDetailChange: { detail($0, tab: tab) })
        }
    }

    private func detail(_ active: Bool, tab: NativeTab) {
        if active { detailTabs.insert(tab) } else { detailTabs.remove(tab) }
    }

    private func select(_ tab: NativeTab) {
        dockSelectionSettle?.cancel()
        if tab != selected && !reduceMotion {
            withAnimation(.easeOut(duration: 0.07)) { dockSelectionMoving = true }
            dockSelectionSettle = Task { @MainActor in
                do { try await Task.sleep(for: .milliseconds(220)) } catch { return }
                withAnimation(.spring(duration: 0.20, bounce: 0.12)) { dockSelectionMoving = false }
            }
        } else { dockSelectionMoving = false }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        if tab != selected, let channelID = store.selectedChannelID {
            parkedChannels[selected] = channelID; store.close(channelID)
        }
        if tab != selected, let channelID = parkedChannels[tab], let channel = store.channels.first(where: { $0.id == channelID }) {
            Task { await store.open(channel) }
        }
        if tab == selected { parkedChannels[tab] = nil; resetIDs[tab, default: 0] += 1; detailTabs.remove(tab) }
        visited.insert(tab); selected = tab; showMore = false
    }

    private func dock(width: CGFloat) -> some View {
        let count = max(0, min(8, Int((width - 82) / 46) - 1))
        return HStack(spacing: 12) {
            HStack(spacing: 0) {
                ForEach(Array(NativeTab.allCases.prefix(count))) { tab in
                    Button { select(tab) } label: {
                        MacroIcon(name: tab.dockIcon(selected: (!emailCompositionActive && !cognitionTabs.contains(selected) && selected == tab)))
                            .foregroundStyle((!emailCompositionActive && !cognitionTabs.contains(selected) && selected == tab) ? Color.white : .primary)
                            .frame(maxWidth: .infinity).frame(height: 46)

                    }.buttonStyle(MacroDockButtonStyle(tab: tab, selected: (!emailCompositionActive && !cognitionTabs.contains(selected) && selected == tab), selectionNamespace: dockSelection, moving: dockSelectionMoving)).accessibilityLabel(tab.title).accessibilityIdentifier("dock-\(tab.id)").accessibilityAddTraits((!emailCompositionActive && !cognitionTabs.contains(selected) && selected == tab) ? .isSelected : [])
                    Spacer(minLength: 0)
                }
                Button { showMore = true } label: {
                    MacroIcon(name: "caret-up").frame(width: 46, height: 46).contentShape(Circle())
                }.buttonStyle(.plain).accessibilityLabel("More views").accessibilityIdentifier("dock-more")
            }.nativeGlass()
                .animation(reduceMotion ? nil : .spring(duration: 0.34, bounce: 0.08), value: selected)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: !emailCompositionActive && !cognitionTabs.contains(selected))
            Button { showSearch = true } label: {
                MacroIcon(name: "magnifying-glass").frame(width: 46, height: 46).contentShape(Circle())
            }.buttonStyle(.plain).nativeGlass().accessibilityLabel("Search Macro").accessibilityIdentifier("dock-search")
        }
    }

    private var actionRow: some View {
        HStack(alignment: .bottom, spacing: 12) {
            NativeQuickAgentComposer(session: session, store: store, externalFocusRequest: quickAgentFocusRequest, onFocusChange: { quickAgentFocused = $0 }) { model in
                quickCognition = model; cognitionOrigin = selected
                agentRefreshRequest += 1
            }
            if selected != .agents {
                Button {
                    if selected == .email && emailCompositionActive { showCreateMenu = true }
                    else if [.calendar, .email, .files, .tasks, .channels].contains(selected) { creates[selected, default: 0] += 1 }
                    else if selected == .calls { showCreate = true }
                    else { showCreateMenu = true }
                } label: {
                    HStack(spacing: 6 * rem) { MacroIcon(name: "plus", size: 22 * rem); Text(selected == .email && emailCompositionActive ? "New" : selected.createTitle) }
                        .font(.system(size: 15 * rem, weight: .medium)).padding(.leading, 12 * rem).padding(.trailing, 16 * rem).frame(height: 46).contentShape(Capsule())
            }.buttonStyle(.plain).nativeGlass().accessibilityIdentifier("workspace-create")
                .background(GeometryReader { geometry in Color.clear.preference(key: NativeCreateTriggerFrame.self, value: geometry.frame(in: .named("workspace-shell"))) })
            }
        }
    }

    private var moreSheet: some View {
        NativeFloatingDrawer(onDismiss: { showMore = false }) {
        NativeDrawerScrollView {
        VStack(spacing: 4 * rem) {
            drawerButton("Settings", symbol: "gearshape") {
                showMore = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showAccount = true }
            }
            Divider().padding(.horizontal, -4 * rem)
            drawerButton("CRM", symbol: "building.2") {
                showMore = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { webOrigin = selected; webURL = session.environment.webURL.appendingPathComponent("companies") }
            }
            ForEach(Array(NativeTab.allCases.dropFirst(max(0, min(8, Int((UIScreen.main.bounds.width - 82) / 46) - 1))).reversed())) { tab in
                drawerButton(tab.title, symbol: tab.symbol, selected: selected == tab) { select(tab) }
            }
            Divider().padding(.horizontal, -4 * rem)
            Button { showMore = false } label: {
                Text("Views").font(.system(size: 14 * rem, weight: .medium)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12 * rem).frame(height: 36 * rem)
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 16 * rem)
        }
        }
    }

    private func drawerButton(_ title: String, symbol: String, selected: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12 * rem) { MacroIcon(name: drawerIcon(symbol), size: 16 * rem); Text(title).font(.system(size: 14 * rem)); Spacer() }
                .foregroundStyle(selected ? MacroTheme.accent : Color.primary).padding(.horizontal, 12 * rem).frame(height: 44 * rem).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private func drawerIcon(_ symbol: String) -> String {
        switch symbol { case "gearshape": "gear"; case "building.2": "building"; case "phone": "phone-call"; case "checklist": "list-checks"; case "sparkles": "sparkle"; default: symbol }
    }
    private var createSheet: some View {
        NativeFloatingDrawer(onDismiss: { showCreate = false }, handleBottomPadding: 4) {
            HStack {
                Text("Create new").font(.system(size: 18 * rem, weight: .semibold))
                Spacer()
                Button { showCreate = false } label: {
                    MacroIcon(name: "x", size: 20 * rem).frame(width: 44 * rem, height: 44 * rem).background(Color.primary.opacity(0.06), in: Circle())
                }.buttonStyle(.plain).accessibilityLabel("Close create menu")
            }.padding(.horizontal, 24 * rem).padding(.bottom, 20 * rem)
            NativeDrawerScrollView(reservedHeight: 64 * rem) {
                VStack(spacing: 0) {
                    createDrawerRow("Email", icon: "envelope") { create(.email) }
                    createDrawerRow("Automation", icon: "clock-clockwise", hint: "Run AI on a schedule") { openSchedule(.automation) }
                    createDrawerRow("Agent", icon: "sparkle", hint: "Dedicated Agent Session") {
                        showCreate = false; select(.agents)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { newAgentOrigin = .agents }
                    }
                    createDrawerRow("Skill", icon: "blueprint", hint: "Custom agent skill") {
                        showCreate = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { webOrigin = selected; webURL = session.environment.webURL.appendingPathComponent("component/skill-compose") }
                    }
                    createDrawerRow("Document", icon: "file-text") { create(.files) }
                    createDrawerRow("Task", icon: "list-checks") { create(.tasks) }
                    createDrawerRow("Reminder", icon: "bell", hint: "Remember something later") { openSchedule(.reminder) }
                    createDrawerRow("Snippet", icon: "text-align-left", hint: "Reusable document template") { createResource(.snippet) }
                    createDrawerRow("Message", icon: "chat-circle", hint: "Quick send message") { create(.channels) }
                    createDrawerRow("Channel", icon: "hash-straight", hint: "A space for your team") {
                        showCreate = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showChannelCreate = true }
                    }
                    ForEach([WorkspaceBlankResource.canvas, .spreadsheet, .folder, .code], id: \.self) { resource in
                        createDrawerRow(resource.title, icon: resource.icon) { createResource(resource) }
                    }
                    createDrawerRow("Call", icon: "phone", hint: "New Call") {
                        showCreate = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { webOrigin = selected; webURL = session.environment.webURL.appendingPathComponent("meet/new") }
                    }
                }.padding(4 * rem).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 24 * rem)).padding(.horizontal, 12 * rem)
            }
        }
    }
    private func createDrawerRow(_ title: String, icon: String, hint: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16 * rem) {
                MacroIcon(name: icon, size: 20 * rem).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2 * rem) {
                    Text(title).font(.system(size: 15 * rem, weight: .medium))
                    if let hint { Text(hint).font(.system(size: 14 * rem)).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.foregroundStyle(.primary).padding(.horizontal, 16 * rem).padding(.vertical, 12 * rem).frame(minHeight: 56 * rem).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("create-drawer-" + title.lowercased())
    }
    private func create(_ tab: NativeTab) {
        if tab == .files { createResource(.document); return }
        showCreate = false; select(tab)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { creates[tab, default: 0] += 1 }
    }
    private func openSchedule(_ kind: NativeScheduleKind) {
        showCreate = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { scheduleKind = kind }
    }
    private func createResource(_ resource: WorkspaceBlankResource) {
        guard !creatingResource else { return }
        showCreate = false; creatingResource = true; createError = nil
        Task {
            defer { creatingResource = false }
            do {
                let item = try await WorkspaceService(session: session).createBlankResource(resource)
                quickAgentAPI = nil; quickAgentOrigin = selected; quickAgent = item
            } catch { createError = error.localizedDescription }
        }
    }

}

extension URL: @retroactive Identifiable { public var id: String { absoluteString } }

private struct NativeCreateTriggerFrame: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { value = nextValue() }
}

private struct NativeGlass: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26, *) { content.glassEffect(.regular.interactive(), in: Capsule()).shadow(color: .black.opacity(0.18), radius: 14, y: 7) }
        else { content.background(.ultraThinMaterial, in: Capsule()).overlay(Capsule().stroke(.separator.opacity(0.5), lineWidth: 0.5)) }
    }
}
extension View { func nativeGlass() -> some View { modifier(NativeGlass()) } }
