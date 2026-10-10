import Foundation
import Observation

@MainActor @Observable
final class NativeCalendarStore {
    var focusDate: Date
    var period: NativeCalendarPeriod = .month
    private(set) var sources: [NativeCalendarSource] = []
    private(set) var selectedSourceIDs: Set<String> = []
    private(set) var items: [NativeCalendarItem] = []
    private(set) var isLoading = false
    private(set) var isSyncing = false
    private(set) var isSaving = false
    private(set) var error: String?
    private(set) var mutationError: String?
    var calendar: Calendar
    @ObservationIgnored private let service: any NativeCalendarService
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var loadedSources = false
    @ObservationIgnored private let selectionKey: String?
    @ObservationIgnored private var loadedRange: NativeCalendarRange?

    init(service: any NativeCalendarService, date: Date = Date(), calendar: Calendar? = nil, selectionKey: String? = nil) {
        self.service = service; focusDate = date; self.selectionKey = selectionKey
        var local = calendar ?? Calendar(identifier: .gregorian)
        if calendar == nil { local.timeZone = .current; local.locale = .current; local.firstWeekday = Calendar.current.firstWeekday }
        self.calendar = local
    }
    convenience init(session: NativeSession) {
        #if DEBUG
        if session.isDemo { self.init(service: FixtureCalendarService()); return }
        #endif
        self.init(service: NativeCalendarAPI(session: session), selectionKey: "native-calendar-hidden-" + session.environment.rawValue + ":" + (session.userID ?? ""))
    }

    var range: NativeCalendarRange { NativeCalendarDates.range(containing: focusDate, period: period, calendar: calendar) }
    var queryKey: String { period.rawValue + range.startDate + range.endDate }
    var writableSources: [NativeCalendarSource] { sources.filter(\.isWritable) }
    var entries: [NativeCalendarEntry] {
        items.compactMap { item in
            guard !item.occurrence.isCancelled, item.event.status != "cancelled",
                  let interval = item.occurrence.time.interval(calendar: calendar) else { return nil }
            let copies = item.event.sources ?? []
            if !copies.isEmpty {
                guard let copy = copies.first(where: { selectedSourceIDs.contains($0.calendarId) }) else { return nil }
                return NativeCalendarEntry(item: item, copy: copy, interval: interval)
            }
            if let id = item.event.calendarId, !selectedSourceIDs.contains(id) { return nil }
            if selectedSourceIDs.isEmpty { return nil }
            return NativeCalendarEntry(item: item, interval: interval)
        }.sorted {
            if $0.interval.start != $1.interval.start { return $0.interval.start < $1.interval.start }
            return $0.id < $1.id
        }
    }
    func entries(on date: Date) -> [NativeCalendarEntry] {
        let day = calendar.dateInterval(of: .day, for: date)!
        return entries.filter { $0.interval.start < day.end && $0.interval.end > day.start }
            .sorted { first, second in first.isAllDay != second.isAllDay ? first.isAllDay : first.interval.start < second.interval.start }
    }
    func entry(id: String) -> NativeCalendarEntry? { entries.first { $0.id == id } }
    func source(id: String?) -> NativeCalendarSource? { sources.first { $0.id == id } }
    func canEdit(_ entry: NativeCalendarEntry) -> Bool {
        !entry.isReadOnly && source(id: entry.calendarID)?.isWritable == true &&
            (entry.item.event.eventType == nil || entry.item.event.eventType == "default")
    }
    func setVisible(_ id: String, visible: Bool) {
        if visible { selectedSourceIDs.insert(id) } else { selectedSourceIDs.remove(id) }
        saveSelection()
    }
    func showAllSources() { selectedSourceIDs = Set(sources.map(\.id)); saveSelection() }
    func hideAllSources() { selectedSourceIDs = []; saveSelection() }
    private func saveSelection() {
        guard let selectionKey else { return }
        UserDefaults.standard.set(Array(Set(sources.map(\.id)).subtracting(selectedSourceIDs)), forKey: selectionKey)
    }
    func shift(_ direction: Int) {
        let unit: Calendar.Component = period == .month ? .month : period == .week ? .weekOfYear : .day
        if let next = calendar.date(byAdding: unit, value: direction, to: focusDate) { focusDate = next }
    }
    func today() { focusDate = Date() }

    func refresh(reloadSources: Bool = false) async {
        generation += 1; let current = generation; let requestedRange = range
        guard NativeCalendarDates.supported(requestedRange, calendar: calendar) else {
            items = []; error = NativeCalendarError.unsupportedRange.localizedDescription; isLoading = false; isSyncing = false
            return
        }
        if loadedRange.map({ $0.start <= requestedRange.start && $0.end >= requestedRange.end }) != true { items = [] }
        isLoading = true; error = nil
        defer { if current == generation { isLoading = false } }
        do {
            if !loadedSources || reloadSources {
                let calendars = try await service.calendars()
                guard current == generation, !Task.isCancelled else { return }
                let wereAllVisible = !loadedSources || selectedSourceIDs == Set(sources.map(\.id))
                sources = calendars
                selectedSourceIDs = wereAllVisible ? Set(calendars.map(\.id)) : selectedSourceIDs.intersection(calendars.map(\.id))
                if !loadedSources, let selectionKey {
                    selectedSourceIDs.subtract(UserDefaults.standard.stringArray(forKey: selectionKey) ?? [])
                }
                loadedSources = true
            }
            let result = try await service.occurrences(in: requestedRange)
            guard current == generation, !Task.isCancelled else { return }
            items = result.items; isSyncing = result.isSyncing; loadedRange = requestedRange
        } catch is CancellationError { }
        catch { if current == generation { self.error = error.localizedDescription } }
    }

    func save(_ draft: NativeCalendarDraft, editing entry: NativeCalendarEntry?) async -> Bool {
        guard !isSaving else { return false }
        isSaving = true; mutationError = nil
        defer { isSaving = false }
        do {
            guard let source = source(id: draft.calendarID), source.isWritable,
                  entry.map(canEdit) ?? true else { throw NativeCalendarError.missingCalendar }
            let body = try draft.mutation(editing: entry, calendar: calendar)
            let result: NativeCalendarEvent
            if let entry { result = try await service.update(entry.eventID, body: body) }
            else { result = try await service.create(body) }
            await refresh()
            if let entry {
                // The provider may finish before occurrence materialization. Reflect the accepted fields locally.
                var updated = entry.item
                updated.event.title = body.title ?? result.title
                updated.event.description = body.description ?? updated.event.description
                updated.event.location = body.location ?? updated.event.location
                updated.event.attendees = result.attendees
                if let time = body.time { updated.occurrence.time = time }
                if let index = updated.event.sources?.firstIndex(where: { $0.calendarId == entry.calendarID }) {
                    updated.event.sources?[index].title = body.title ?? entry.title
                    if let description = body.description { updated.event.sources?[index].description = description }
                    if let location = body.location { updated.event.sources?[index].location = location }
                }
                if let index = items.firstIndex(where: { $0.id == entry.id }) { items[index] = updated }
                else { items.append(updated) }
            } else if !items.contains(where: { $0.event.id == result.id }) {
                items.append(NativeCalendarItem(event: result, occurrence: NativeCalendarOccurrence(eventId: result.id,
                    occurrenceKey: result.time.interval(calendar: calendar).map { MessageDate.string($0.start) } ?? result.id,
                    isCancelled: false, time: result.time)))
            }
            if entry == nil, let interval = result.time.interval(calendar: calendar) { focusDate = interval.start }
            return true
        } catch { mutationError = error.localizedDescription; return false }
    }

    func delete(_ entry: NativeCalendarEntry, scope: String) async -> Bool {
        guard !isSaving, canEdit(entry) else { return false }
        isSaving = true; mutationError = nil
        defer { isSaving = false }
        do {
            try await service.delete(entry.eventID, calendarID: entry.calendarID, scope: scope,
                recurrenceID: scope == "all" ? nil : entry.item.occurrence.recurrenceId ?? entry.item.occurrence.occurrenceKey)
            await refresh()
            items = items.compactMap { item in
                guard item.event.id == entry.eventID, scope == "all" || item.id == entry.id else { return item }
                var remaining = item
                let copies = (item.event.sources ?? []).filter { $0.calendarId != entry.calendarID }
                guard !copies.isEmpty else { return nil }
                remaining.event.sources = copies
                return remaining
            }
            return true
        } catch { mutationError = error.localizedDescription; return false }
    }

    func respond(_ entry: NativeCalendarEntry, response: String, scope: String? = nil) async {
        guard !isSaving else { return }
        isSaving = true; mutationError = nil
        defer { isSaving = false }
        do {
            let effectiveScope = scope ?? (entry.isRecurring ? "this_event" : "all")
            _ = try await service.respond(entry.eventID, calendarID: entry.calendarID, response: response,
                scope: effectiveScope, recurrenceID: effectiveScope == "all" ? nil : entry.item.occurrence.recurrenceId ?? entry.item.occurrence.occurrenceKey)
            for index in items.indices where items[index].id == entry.id || effectiveScope == "all" && items[index].event.id == entry.eventID {
                for guest in items[index].event.attendees.indices where items[index].event.attendees[guest].isSelf {
                    items[index].event.attendees[guest].responseStatus = response
                }
            }
        } catch { mutationError = error.localizedDescription }
    }
    func clearMutationError() { mutationError = nil }
}
