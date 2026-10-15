import SwiftUI

/// Native presentation of the mobile calendar: period header, calendar grid, and native drawers.
struct CalendarWorkspaceView: View {
    let session: NativeSession
    let createRequest: Int
    let onDetailChange: (Bool) -> Void
    @State private var store: NativeCalendarStore
    @State private var selected: NativeCalendarEntry?
    @State private var isChangingPeriod = false
    @State private var showSettings = false
    @State private var showMonthPicker = false
    @State private var showCreate = false
    @State private var showSearch = false
    @State private var searchAfterSettings = false
    @State private var pendingSearchSelection: NativeCalendarEntry?
    @State private var showCalls = false
    @State private var showWorkspace = false
    @AppStorage("native-calendar-period") private var preferredPeriod = NativeCalendarPeriod.day.rawValue
    @AppStorage("native-calendar-weekends") private var showWeekends = true
    @AppStorage("native-calendar-first-weekday") private var firstWeekday = 1
    @AppStorage("native-calendar-24-hour") private var use24Hour = false
    @Environment(\.scenePhase) private var scenePhase

    init(session: NativeSession, createRequest: Int = 0, onDetailChange: @escaping (Bool) -> Void = { _ in }) {
        self.session = session; self.createRequest = createRequest; self.onDetailChange = onDetailChange
        let model = NativeCalendarStore(session: session)
        let testing = ProcessInfo.processInfo.arguments.contains("--ui-testing")
        model.period = testing ? .day : NativeCalendarPeriod(rawValue: UserDefaults.standard.string(forKey: "native-calendar-period") ?? "Day") ?? .day
        model.calendar.firstWeekday = testing ? 1 : UserDefaults.standard.object(forKey: "native-calendar-first-weekday") as? Int ?? 1
        _store = State(initialValue: model)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let error = store.error {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.circle")
                    Text(error).font(.footnote)
                    Spacer(minLength: 0)
                    Button("Retry") { Task { await store.refresh(reloadSources: true) } }.font(.footnote.weight(.semibold))
                }.foregroundStyle(.secondary).padding(12)
            }
            Group {
                if store.isLoading && store.sources.isEmpty {
                    ProgressView("Loading calendar…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.sources.isEmpty && store.error == nil {
                    ContentUnavailableView {
                        Label("Your day, in one place", systemImage: "calendar")
                    } description: { Text("Connect your calendar to bring events into Macro.") }
                    actions: { Button("Connect a calendar") { showWorkspace = true }.buttonStyle(.bordered) }
                } else if store.period == .month {
                    NativeCalendarMonthGrid(store: store, showWeekends: showWeekends, onSelect: select)
                } else {
                    NativeCalendarTimeGrid(store: store, showWeekends: showWeekends, use24Hour: use24Hour, onSelect: select)
                }
            }
            .contentShape(Rectangle())
            .simultaneousGesture(DragGesture(minimumDistance: 24).onChanged { value in
                if abs(value.translation.width) > 24 && abs(value.translation.width) > abs(value.translation.height) * 1.8 { isChangingPeriod = true }
            }.onEnded { value in
                if abs(value.translation.width) > 75 && abs(value.translation.width) > abs(value.translation.height) * 1.8 { store.shift(value.translation.width < 0 ? 1 : -1) }
                // A horizontal drag must not also activate the event beneath its finger.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { isChangingPeriod = false }
            })
            .accessibilityAction(named: "Next \(store.period.rawValue.lowercased())") { store.shift(1) }
            .accessibilityAction(named: "Previous \(store.period.rawValue.lowercased())") { store.shift(-1) }
            if store.isSyncing {
                HStack(spacing: 7) { ProgressView().controlSize(.mini); Text("Syncing your calendar…").font(.caption2).foregroundStyle(.secondary) }.padding(6)
            }
        }
        .background(MacroTheme.background)
        .task(id: store.queryKey) { await store.refresh() }
        .task(id: store.isSyncing) {
            while store.isSyncing && !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) } catch { break }
                await store.refresh()
            }
        }
        .onChange(of: scenePhase) { _, value in if value == .active { Task { await store.refresh() } } }
        .onChange(of: store.period) { _, value in preferredPeriod = value.rawValue }
        .onChange(of: firstWeekday) { _, value in store.calendar.firstWeekday = value }
        .onChange(of: createRequest) { _, _ in store.clearMutationError(); showCreate = true }
        .fullScreenCover(item: $selected) { NativeCalendarDetails(store: store, original: $0, session: session).presentationBackground(.clear) }
        .fullScreenCover(isPresented: $showCreate) { NativeCalendarEditor(store: store, entry: nil, date: newEventDate).presentationBackground(.clear) }
        .fullScreenCover(isPresented: $showSettings, onDismiss: {
            if searchAfterSettings { searchAfterSettings = false; showSearch = true }
        }) {
            NativeCalendarSettingsSheet(store: store, session: session, showWeekends: $showWeekends, firstWeekday: $firstWeekday, use24Hour: $use24Hour) {
                searchAfterSettings = true; showSettings = false
            }.presentationBackground(.clear)
        }
        .fullScreenCover(isPresented: $showMonthPicker) { NativeCalendarMonthPicker(store: store).presentationBackground(.clear) }
        .fullScreenCover(isPresented: $showSearch, onDismiss: {
            if let entry = pendingSearchSelection { pendingSearchSelection = nil; select(entry) }
        }) {
            NativeCalendarSearchSheet(session: session, store: store) { entry in
                pendingSearchSelection = entry; showSearch = false
            }.presentationBackground(.clear)
        }
        .sheet(isPresented: $showCalls) { WorkspaceSheet(session: session, url: session.environment.webURL.appendingPathComponent("calls")) }
        .sheet(isPresented: $showWorkspace) { WorkspaceSheet(session: session, url: session.environment.webURL.appendingPathComponent("settings/connections")) }
        .environment(\.calendar, store.calendar)
    }

    private func select(_ entry: NativeCalendarEntry) { guard !isChangingPeriod else { return }; store.clearMutationError(); selected = entry }
    private var newEventDate: Date {
        if store.calendar.isDateInToday(store.focusDate) { return Date().addingTimeInterval(3_600) }
        return store.calendar.date(bySettingHour: 9, minute: 0, second: 0, of: store.focusDate) ?? store.focusDate
    }
    private var header: some View {
        HStack(spacing: 2) {
            Button { showMonthPicker = true } label: {
                HStack(spacing: 5) {
                    Text(store.focusDate.formatted(.dateTime.month(.wide).year())).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                }.padding(.horizontal, 10).frame(height: 44)
            }.buttonStyle(.plain).nativeGlass().accessibilityLabel("Choose month").accessibilityIdentifier("calendar-month")
            Spacer(minLength: 0)
            HStack(spacing: 0) {
            Button { store.today() } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 2).stroke(lineWidth: 1.5).frame(width: 17, height: 18)
                    Rectangle().frame(width: 17, height: 1.5).offset(y: -4)
                    HStack(spacing: 8) { Capsule().frame(width: 1.5, height: 4); Capsule().frame(width: 1.5, height: 4) }.offset(y: -9)
                    Text(String(store.calendar.component(.day, from: Date()))).font(.system(size: 8, weight: .bold)).offset(y: 3)
                }.frame(width: 36, height: 40).contentShape(Rectangle()).accessibilityHidden(true)
            }.buttonStyle(.plain).accessibilityLabel("Go to today").accessibilityIdentifier("calendar-today")
            Button { store.clearMutationError(); showCreate = true } label: {
                MacroIcon(name: "plus", size: 20).frame(width: 36, height: 40)
            }.buttonStyle(.plain).accessibilityLabel("New event").accessibilityIdentifier("calendar-create")
            Button { showCalls = true } label: {
                MacroIcon(name: "phone-call", size: 20).frame(width: 36, height: 40)
            }.buttonStyle(.plain).accessibilityLabel("New call").accessibilityHint("Open Calls to choose recipients and start a call.").accessibilityIdentifier("calendar-new-call")
            Button { showSettings = true } label: {
                MacroIcon(name: "gear", size: 20).frame(width: 36, height: 40)
            }.buttonStyle(.plain).accessibilityLabel("Calendar settings").accessibilityIdentifier("calendar-filter")
            }.padding(.horizontal, 4).nativeGlass()
        }.padding(.horizontal, 8).padding(.bottom, 5)
    }
}

private struct NativeCalendarMonthPicker: View {
    let store: NativeCalendarStore
    @State private var year: Int
    @Environment(\.dismiss) private var dismiss
    init(store: NativeCalendarStore) { self.store = store; _year = State(initialValue: store.calendar.component(.year, from: store.focusDate)) }
    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }) {
            NativeDrawerScrollView {
                VStack(spacing: 21.25) {
                    HStack {
                        Button { year -= 1 } label: { MacroIcon(name: "caret-left", size: 21.25).frame(width: 46.75, height: 46.75) }.accessibilityLabel("Previous year")
                        Spacer(); Text(String(year)).font(.system(size: 19.125, weight: .semibold)); Spacer()
                        Button { year += 1 } label: { MacroIcon(name: "caret-right", size: 21.25).frame(width: 46.75, height: 46.75) }.accessibilityLabel("Next year")
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 10.625) {
                        ForEach(1...12, id: \.self) { month in
                            let current = store.calendar.component(.month, from: store.focusDate) == month && store.calendar.component(.year, from: store.focusDate) == year
                            Button { store.focusDate = store.calendar.date(from: DateComponents(year: year, month: month, day: 1)) ?? store.focusDate; dismiss() } label: {
                                Text(store.calendar.shortMonthSymbols[month - 1]).font(.system(size: 15.94, weight: current ? .semibold : .regular)).frame(maxWidth: .infinity).frame(height: 46.75).background(current ? MacroTheme.accent.opacity(0.2) : Color.primary.opacity(0.04), in: Capsule())
                            }.accessibilityAddTraits(current ? .isSelected : [])
                        }
                    }
                    Button("Today") { store.today(); dismiss() }.font(.system(size: 15.94, weight: .medium)).frame(maxWidth: .infinity).frame(height: 46.75)
                }.padding(.horizontal, 25.5).padding(.bottom, 17).buttonStyle(.plain)
            }
        }
    }
}

private struct NativeCalendarSettingsSheet: View {
    @Bindable var store: NativeCalendarStore
    let session: NativeSession
    @Binding var showWeekends: Bool
    @Binding var firstWeekday: Int
    @Binding var use24Hour: Bool
    let search: () -> Void
    @State private var accounts = false
    @Environment(\.dismiss) private var dismiss
    private var emails: [String] { Array(Set(store.sources.map(\.emailAddress))).sorted() }
    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }) {
            NativeDrawerScrollView {
                VStack(alignment: .leading, spacing: 17) {
                    section("Period") { ForEach(NativeCalendarPeriod.allCases) { period in row(period.rawValue, checked: store.period == period) { store.period = period; dismiss() }.accessibilityIdentifier("calendar-period-\(period.rawValue.lowercased())") } }
                    if store.sources.count > 1 {
                        section("Calendars") { ForEach(emails, id: \.self) { email in
                            let sources = store.sources.filter { $0.emailAddress == email }
                            let count = sources.filter { store.selectedSourceIDs.contains($0.id) }.count
                            row(email, checked: count == sources.count, partial: count > 0 && count < sources.count) { for source in sources { store.setVisible(source.id, visible: count != sources.count) } }.accessibilityIdentifier("calendar-account-" + email).accessibilityValue(count == 0 ? "Hidden" : count == sources.count ? "Visible" : "Partially visible")
                        } }
                    }
                    section("Display") { row("Show weekends", checked: showWeekends) { showWeekends.toggle() }.accessibilityIdentifier("calendar-weekends") }
                    section("Week starts on") { row("Sunday", checked: firstWeekday == 1) { firstWeekday = 1 }; row("Monday", checked: firstWeekday == 2) { firstWeekday = 2 } }
                    section("Time format") { row("12-hour", checked: !use24Hour) { use24Hour = false }; row("24-hour", checked: use24Hour) { use24Hour = true } }
                    section("Accounts") {
                        ForEach(emails, id: \.self) { email in row(email, checked: false) { accounts = true } }
                        row("Manage connected accounts", checked: false) { accounts = true }
                    }
                }.padding(.horizontal, 12.75)
            }
        }.fullScreenCover(isPresented: $accounts) { WorkspaceSheet(session: session, url: session.environment.webURL.appendingPathComponent("settings/connections")) }
    }
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8.5) {
            Text(title).font(.system(size: 12.75)).foregroundStyle(.secondary).padding(.horizontal, 12.75)
            VStack(spacing: 0, content: content).padding(4.25).background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 25.5))
        }
    }
    private func row(_ title: String, checked: Bool, partial: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { HStack { Text(title).lineLimit(1); Spacer(); MacroIcon(name: partial ? "minus" : "check", size: 17).foregroundStyle(MacroTheme.accent).opacity(checked || partial ? 1 : 0) }.font(.system(size: 14.875)).padding(.horizontal, 12.75).frame(height: 46.75).contentShape(Rectangle()) }.buttonStyle(.plain).accessibilityAddTraits(checked ? .isSelected : [])
    }
}


enum NativeCalendarColors {
    static func eventFill(_ color: Color) -> Color {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        let value = NativeCalendarPalette.eventRGB(red: red, green: green, blue: blue)
        return Color(red: value.red, green: value.green, blue: value.blue)
    }
    static func color(_ hex: String?) -> Color {
        guard let hex, hex.hasPrefix("#"), hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return .accentColor }
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}
