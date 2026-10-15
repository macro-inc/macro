import SwiftUI

struct NativeCalendarSearchSheet: View {
    let session: NativeSession
    let store: NativeCalendarStore
    let select: (NativeCalendarEntry) -> Void
    @State private var search = ""
    @State private var items: [WorkspaceItem] = []
    @State private var nextCursor: String?
    @State private var error: String?
    @State private var loading = false
    @State private var opening = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }, maximumHeightFraction: 0.9) {
            VStack(spacing: 12.75) {
                HStack(spacing: 8.5) {
                    MacroIcon(name: "magnifying-glass", size: 21.25)
                    TextField("Search calendar", text: $search).font(.system(size: 15.94)).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("calendar-search-input")
                    Button { dismiss() } label: { MacroIcon(name: "x", size: 21.25).frame(width: 38.25, height: 38.25) }.accessibilityLabel("Close calendar search")
                }.padding(.horizontal, 25.5)
                NativeDrawerScrollView(reservedHeight: 51) {
                    VStack(alignment: .leading, spacing: 17) {
                        if loading || opening { ProgressView(opening ? "Opening event…" : "Searching…") }
                        if let error { Text(error).font(.system(size: 13.8)).foregroundStyle(.red) }
                        if search.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 { Text("Search your calendars by event name or details.").foregroundStyle(.secondary) }
                        else if !loading && items.isEmpty && error == nil { Text("No events found").foregroundStyle(.secondary) }
                        ForEach(items) { item in
                            Button { Task { await open(item) } } label: {
                                VStack(alignment: .leading, spacing: 4.25) {
                                    Text(item.title).foregroundStyle(.primary)
                                    if let date = Self.date(for: item, calendar: store.calendar) { Text(date, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()).font(.system(size: 12.75)).foregroundStyle(.secondary) }
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8.5).contentShape(Rectangle())
                            }.disabled(opening)
                        }
                        if nextCursor != nil { Button("Load more results") { Task { await fetch(more: true) } }.disabled(loading) }
                    }.font(.system(size: 14.875)).padding(.horizontal, 25.5)
                }
            }.buttonStyle(.plain)
        }.task(id: search) {
            items = []; nextCursor = nil; error = nil
            guard search.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 else { loading = false; return }
            loading = true
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            await fetch()
        }
    }

    private func fetch(more: Bool = false) async {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        loading = true; error = nil
        do {
            let result: WorkspacePage
            if session.isDemo {
                result = WorkspacePage(items: store.entries.filter { $0.title.localizedCaseInsensitiveContains(query) }.map { entry in
                    WorkspaceItem(id: entry.eventID, kind: .calendar, title: entry.title, payload: .object([
                        "occurrenceKey": .string(entry.item.occurrence.occurrenceKey),
                        "time": .object(["startsAt": .string(MessageDate.string(entry.interval.start))]),
                    ]))
                })
            } else { result = try await WorkspaceService(session: session).search(query, cursor: more ? nextCursor : nil, kind: .calendar) }
            guard !Task.isCancelled, search.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            if more {
                let known = Set(items.map(\.id)); items.append(contentsOf: result.items.filter { !known.contains($0.id) })
            } else { items = result.items }
            nextCursor = result.nextCursor
        } catch is CancellationError { return }
        catch { if search.trimmingCharacters(in: .whitespacesAndNewlines) == query { self.error = error.localizedDescription } }
        if search.trimmingCharacters(in: .whitespacesAndNewlines) == query { loading = false }
    }
    private func open(_ item: WorkspaceItem) async {
        guard !opening else { return }
        opening = true; error = nil
        defer { opening = false }
        let occurrenceKey = Self.occurrenceKey(for: item)
        if let existing = store.entries.first(where: { $0.eventID == item.id && (occurrenceKey == nil || $0.item.occurrence.occurrenceKey == occurrenceKey) }) {
            finish(existing); return
        }
        guard let day = Self.date(for: item, calendar: store.calendar) else {
            error = "This event has no occurrence date available. Try opening it from its calendar date."; return
        }
        let range = NativeCalendarDates.range(containing: day, period: .day, calendar: store.calendar)
        guard NativeCalendarDates.supported(range, calendar: store.calendar) else {
            error = NativeCalendarError.unsupportedRange.localizedDescription; return
        }
        do {
            let page = try await NativeCalendarAPI(session: session).occurrences(in: range)
            guard let found = page.items.first(where: { $0.event.id == item.id && (occurrenceKey == nil || $0.occurrence.occurrenceKey == occurrenceKey) }),
                  let interval = found.occurrence.time.interval(calendar: store.calendar) else {
                error = "This event is no longer available on that date."; return
            }
            let copy = found.event.sources?.first { store.selectedSourceIDs.contains($0.calendarId) } ?? found.event.sources?.first
            finish(NativeCalendarEntry(item: found, copy: copy, interval: interval))
        } catch { self.error = error.localizedDescription }
    }
    private func finish(_ entry: NativeCalendarEntry) {
        store.focusDate = entry.interval.start; store.period = .day
        select(entry)
    }
    static func occurrenceKey(for item: WorkspaceItem) -> String? {
        item.payload["metadata"]["occurrence"]["occurrenceKey"].string ?? item.payload["occurrenceKey"].string
    }
    static func date(for item: WorkspaceItem, calendar: Calendar) -> Date? {
        if let key = occurrenceKey(for: item) {
            if key.count == 10 { return NativeCalendarDates.localDate(key, calendar: calendar) }
            let date = MessageDate.parse(key); if date != .distantPast { return date }
        }
        let metadata = item.payload["metadata"]
        let time = metadata["occurrence"]["time"] != .null ? metadata["occurrence"]["time"] : metadata["time"] != .null ? metadata["time"] : item.payload["time"]
        if let start = time["startsAt"].string {
            let date = MessageDate.parse(start); return date == .distantPast ? nil : date
        }
        if let start = time["startDate"].string { return NativeCalendarDates.localDate(start, calendar: calendar) }
        return nil
    }
}
