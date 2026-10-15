import XCTest
@testable import MacroNative

@MainActor
final class CalendarTests: XCTestCase {
    func testAllDayDatesStayLocalAndUseExclusiveEndAcrossDaylightSaving() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let start = try XCTUnwrap(NativeCalendarDates.localDate("2026-03-08", calendar: calendar))
        let next = try XCTUnwrap(NativeCalendarDates.localDate("2026-03-09", calendar: calendar))
        let time = NativeCalendarTime.allDay(startDate: "2026-03-08", endDate: "2026-03-09")
        let interval = try XCTUnwrap(time.interval(calendar: calendar))
        XCTAssertEqual(interval.start, start)
        XCTAssertEqual(interval.end, next)
        XCTAssertEqual(interval.duration, 23 * 3_600)
        var draft = NativeCalendarDraft(date: start, calendarID: "calendar", calendar: calendar)
        draft.allDay = true; draft.start = start; draft.end = start
        XCTAssertEqual(try draft.mutation(editing: nil, calendar: calendar).time, time)
        XCTAssertNil(NativeCalendarDates.localDate("2026-02-30", calendar: calendar))
    }

    func testRangeIncludesUTCInstantsAndLocalDatesAcrossDST() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let date = try XCTUnwrap(NativeCalendarDates.localDate("2026-03-08", calendar: calendar))
        let range = NativeCalendarDates.range(containing: date, period: .day, calendar: calendar)
        XCTAssertEqual(range.startDate, "2026-03-08")
        XCTAssertEqual(range.endDate, "2026-03-09")
        XCTAssertEqual(MessageDate.string(range.start), "2026-03-08T05:00:00.000Z")
        XCTAssertEqual(MessageDate.string(range.end), "2026-03-09T04:00:00.000Z")
    }

    func testOccurrenceRequestsUseCorrectRoutesAndOpaqueCursorThenDeduplicate() async throws {
        let item = fixtureItem()
        let first = NativeCalendarPage(items: [item], hasMore: true, nextCursor: "opaque+/=cursor", syncStatus: "syncing")
        let second = NativeCalendarPage(items: [item], hasMore: false, nextCursor: nil, syncStatus: "ready")
        var requests: [URLRequest] = []
        let api = NativeCalendarAPI(baseURL: URL(string: "https://gateway.example.test")!) { request in
            requests.append(request)
            return try JSONEncoder().encode(requests.count == 1 ? first : second)
        }
        let range = NativeCalendarDates.range(containing: Date(), period: .month)
        let result = try await api.occurrences(in: range)
        XCTAssertEqual(result.items.count, 1)
        XCTAssertTrue(result.isSyncing)
        XCTAssertEqual(requests.map(\.httpMethod), ["GET", "GET"])
        XCTAssertEqual(requests.first?.url?.path, "/dss/calendar-events")
        let firstQuery = URLComponents(url: requests[0].url!, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(firstQuery?.first { $0.name == "startDate" }?.value, range.startDate)
        XCTAssertEqual(firstQuery?.first { $0.name == "endDate" }?.value, range.endDate)
        XCTAssertEqual(firstQuery?.first { $0.name == "limit" }?.value, "2000")
        let nextQuery = URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(nextQuery?.first { $0.name == "cursor" }?.value, "opaque+/=cursor")
    }

    func testBrokenPaginationStopsInsteadOfLoopingForever() async throws {
        var count = 0
        let api = NativeCalendarAPI(baseURL: URL(string: "https://gateway.example.test")!) { _ in
            count += 1
            return try JSONEncoder().encode(NativeCalendarPage(items: [], hasMore: true, nextCursor: "repeated", syncStatus: "ready"))
        }
        do {
            _ = try await api.occurrences(in: NativeCalendarDates.range(containing: Date(), period: .month))
            XCTFail("A repeated cursor must fail clearly")
        } catch NativeCalendarError.invalidPagination { }
        XCTAssertEqual(count, 2)
    }

    func testCreateEncodesCamelCaseDatesCalendarAndGuestsWithoutUpdateScope() async throws {
        let item = fixtureItem()
        var captured: URLRequest?
        let api = NativeCalendarAPI(baseURL: URL(string: "https://gateway.example.test")!) { request in
            captured = request
            return try JSONEncoder().encode(item.event)
        }
        var draft = NativeCalendarDraft(date: Date(), calendarID: "calendar")
        draft.title = "  Native planning  "; draft.guests = "JAMIE@example.com, jamie@example.com"
        _ = try await api.create(draft.mutation(editing: nil))
        let request = try XCTUnwrap(captured)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/calendar/events")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["calendarId"] as? String, "calendar")
        XCTAssertEqual(body["title"] as? String, "Native planning")
        XCTAssertNil(body["scope"])
        XCTAssertNil(body["recurrenceId"])
        let time = try XCTUnwrap(body["time"] as? [String: String])
        XCTAssertEqual(time["kind"], "timed")
        XCTAssertNotNil(time["startsAt"])
        XCTAssertNotNil(time["timeZone"])
        let guests = try XCTUnwrap(body["attendees"] as? [[String: Any]])
        XCTAssertEqual(guests.count, 1)
        XCTAssertEqual(guests.first?["email"] as? String, "jamie@example.com")
        XCTAssertEqual(guests.first?["isOptional"] as? Bool, false)
    }

    func testUpdateDeleteAndRSVPTargetSelectedCalendarAndOccurrence() async throws {
        let item = fixtureItem()
        var requests: [URLRequest] = []
        let api = NativeCalendarAPI(baseURL: URL(string: "https://gateway.example.test")!) { request in
            requests.append(request)
            if request.httpMethod == "DELETE" { return Data() }
            return try JSONEncoder().encode(item.event)
        }
        _ = try await api.update("event", body: NativeCalendarMutation(calendarId: "shared", title: "Changed", scope: "this_event", recurrenceId: "20260928T100000Z"))
        try await api.delete("event", calendarID: "shared", scope: "this_event", recurrenceID: "20260928T100000Z")
        _ = try await api.respond("event", calendarID: "shared", response: "accepted", scope: "this_event", recurrenceID: "20260928T100000Z")
        XCTAssertEqual(requests.map(\.httpMethod), ["PATCH", "DELETE", "PUT"])
        XCTAssertEqual(requests[0].url?.path, "/calendar/events/event")
        XCTAssertEqual(requests[2].url?.path, "/calendar/events/event/rsvp")
        let query = URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first { $0.name == "calendarId" }?.value, "shared")
        XCTAssertEqual(query?.first { $0.name == "scope" }?.value, "this_event")
        XCTAssertEqual(query?.first { $0.name == "recurrenceId" }?.value, "20260928T100000Z")
    }

    func testUnchangedGuestListTimeAndCustomRemindersAreNotReplaced() throws {
        var item = fixtureItem()
        item.event.attendees = [NativeCalendarAttendee(email: "me@example.com", isOrganizer: true, isSelf: true),
                               NativeCalendarAttendee(email: "guest@example.com", isOptional: true)]
        item.event.reminders = NativeCalendarReminders(useDefault: false, overrides: [NativeCalendarReminder(minutes: 17), NativeCalendarReminder(method: "email", minutes: 60)])
        let entry = NativeCalendarEntry(item: item, interval: try XCTUnwrap(item.occurrence.time.interval()))
        var draft = NativeCalendarDraft(entry: entry)
        draft.title = "Changed title"
        let body = try draft.mutation(editing: entry)
        XCTAssertEqual(body.title, "Changed title")
        XCTAssertNil(body.attendees, "Unchanged attendees must not be replaced and re-notified.")
        XCTAssertNil(body.time)
        XCTAssertNil(body.reminders, "Custom multiple reminders must survive an unrelated edit.")
        XCTAssertNil(body.recurrenceLines)
    }

    func testOnlyOrganizerCanReplaceGuestsAndOptionalFlagsSurvive() throws {
        var item = fixtureItem()
        item.event.attendees = [NativeCalendarAttendee(email: "me@example.com", isOrganizer: true, isSelf: true),
                               NativeCalendarAttendee(email: "optional@example.com", isOptional: true)]
        var entry = NativeCalendarEntry(item: item, interval: try XCTUnwrap(item.occurrence.time.interval()))
        var draft = NativeCalendarDraft(entry: entry)
        draft.guests += ", new@example.com"
        let body = try draft.mutation(editing: entry)
        XCTAssertEqual(body.attendees?.first { $0.email == "optional@example.com" }?.isOptional, true)
        XCTAssertTrue(body.attendees?.contains { $0.email == "me@example.com" } == true)

        entry.item.event.attendees[0].isSelf = false
        let restricted = NativeCalendarDraft(entry: entry)
        XCTAssertFalse(NativeCalendarDraft.canEditGuests(entry))
        XCTAssertNil(try restricted.mutation(editing: entry).attendees)
    }

    func testRecurringOccurrenceAndSeriesEditsUseDeliberateScopes() throws {
        var item = fixtureItem()
        item.event.recurrenceLines = ["RRULE:FREQ=WEEKLY"]
        item.occurrence.recurrenceId = "20260928T100000Z"
        let entry = NativeCalendarEntry(item: item, interval: try XCTUnwrap(item.occurrence.time.interval()))
        var draft = NativeCalendarDraft(entry: entry)
        draft.start = draft.start.addingTimeInterval(60)
        let occurrence = try draft.mutation(editing: entry)
        XCTAssertEqual(occurrence.scope, "this_event")
        XCTAssertEqual(occurrence.recurrenceId, item.occurrence.recurrenceId)
        XCTAssertNotNil(occurrence.time)
        draft.scope = "all"
        let series = try draft.mutation(editing: entry)
        XCTAssertEqual(series.scope, "all")
        XCTAssertNil(series.recurrenceId)
        XCTAssertNil(series.time, "A whole-series detail edit must not move its origin to this occurrence.")
    }

    func testGeneratedRecurringOccurrenceEditTargetsItsOccurrenceKey() throws {
        var item = fixtureItem()
        item.event.recurrenceLines = ["RRULE:FREQ=DAILY"]
        item.occurrence.recurrenceId = nil
        let entry = NativeCalendarEntry(item: item, interval: try XCTUnwrap(item.occurrence.time.interval()))
        var draft = NativeCalendarDraft(entry: entry)
        draft.title = "Only this occurrence"
        let mutation = try draft.mutation(editing: entry)
        XCTAssertEqual(mutation.scope, "this_event")
        XCTAssertEqual(mutation.recurrenceId, item.occurrence.occurrenceKey)
    }

    func testSourceFilteringChoosesTheDisplayedCopyAndItsEditPermission() async throws {
        let service = CalendarTestService()
        var item = fixtureItem()
        item.event.sources = [NativeCalendarCopy(calendarId: "calendar", title: "Personal title", isReadOnly: false),
                              NativeCalendarCopy(calendarId: "shared", title: "Shared title", isReadOnly: true)]
        service.sources.append(NativeCalendarSource(id: "shared", name: "Shared", emailAddress: "me@example.com", emailLinkId: "inbox",
            isPrimary: false, isSubscription: false, isWritable: false))
        service.load.items = [item]
        let store = NativeCalendarStore(service: service)
        await store.refresh()
        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries.first?.title, "Personal title")
        store.setVisible("calendar", visible: false)
        let shared = try XCTUnwrap(store.entries.first)
        XCTAssertEqual(shared.title, "Shared title")
        XCTAssertEqual(shared.calendarID, "shared")
        XCTAssertFalse(store.canEdit(shared))
        store.hideAllSources()
        XCTAssertTrue(store.entries.isEmpty)
    }

    func testAllDayEventIsNotShownOnItsExclusiveEndDate() async throws {
        let service = CalendarTestService()
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let tomorrow = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: today))
        var item = fixtureItem()
        item.occurrence.time = .allDay(startDate: NativeCalendarDates.dateString(today), endDate: NativeCalendarDates.dateString(tomorrow))
        service.load.items = [item]
        let store = NativeCalendarStore(service: service, calendar: calendar)
        await store.refresh()
        XCTAssertEqual(store.entries(on: today).count, 1)
        XCTAssertTrue(store.entries(on: tomorrow).isEmpty)
    }

    func testFailedSaveKeepsExistingEventAndExposesAnError() async throws {
        let service = CalendarTestService()
        service.load.items = [fixtureItem()]
        service.mutationFailure = URLError(.notConnectedToInternet)
        let store = NativeCalendarStore(service: service)
        await store.refresh()
        let entry = try XCTUnwrap(store.entries.first)
        var draft = NativeCalendarDraft(entry: entry)
        draft.title = "Keep this unsaved change"

        let saved = await store.save(draft, editing: entry)
        XCTAssertFalse(saved)
        XCTAssertEqual(store.entries.first?.title, entry.title)
        XCTAssertEqual(draft.title, "Keep this unsaved change")
        XCTAssertNotNil(store.mutationError)
        XCTAssertFalse(store.isSaving)
    }

    func testLatePreviousRangeCannotOverwriteCurrentCalendar() async throws {
        let service = CalendarTestService()
        service.delayLoads = true
        let store = NativeCalendarStore(service: service)
        let first = Task { await store.refresh() }
        try await waitUntil { service.waiting.count == 1 }
        store.shift(1)
        let second = Task { await store.refresh() }
        try await waitUntil { service.waiting.count == 2 }
        var currentItem = fixtureItem(); currentItem.event.id = "current-range"
        service.waiting[1].resume(returning: NativeCalendarLoad(items: [currentItem], isSyncing: false))
        await second.value
        service.waiting[0].resume(returning: NativeCalendarLoad(items: [fixtureItem()], isSyncing: false))
        await first.value
        XCTAssertEqual(store.items.map { $0.event.id }, ["current-range"])
    }

    func testValidationRejectsReversedDatesAndMalformedGuestAddresses() {
        var draft = NativeCalendarDraft(date: Date(), calendarID: "calendar")
        draft.end = draft.start.addingTimeInterval(-1)
        XCTAssertThrowsError(try draft.mutation(editing: nil))
        draft.end = draft.start.addingTimeInterval(3_600)
        draft.guests = "missing-address"
        XCTAssertThrowsError(try draft.mutation(editing: nil))
    }

    func testHiddenCalendarsSurviveReopeningWithoutAffectingAnotherAccount() async {
        let key = "calendar-test-" + UUID().uuidString
        defer { UserDefaults.standard.removeObject(forKey: key) }
        let service = CalendarTestService()
        let first = NativeCalendarStore(service: service, selectionKey: key)
        await first.refresh()
        first.setVisible("calendar", visible: false)
        let reopened = NativeCalendarStore(service: service, selectionKey: key)
        await reopened.refresh()
        XCTAssertTrue(reopened.selectedSourceIDs.isEmpty)
        let anotherAccount = NativeCalendarStore(service: service)
        await anotherAccount.refresh()
        XCTAssertEqual(anotherAccount.selectedSourceIDs, ["calendar"])
        reopened.showAllSources()
        let restored = NativeCalendarStore(service: service, selectionKey: key)
        await restored.refresh()
        XCTAssertEqual(restored.selectedSourceIDs, ["calendar"])
    }

    func testRecurringRsvpTargetsTheChosenOccurrenceOrEntireSeries() async throws {
        var first = fixtureItem()
        first.event.recurrenceLines = ["RRULE:FREQ=WEEKLY"]
        first.event.attendees = [.init(email: "me@example.com", isSelf: true)]
        first.occurrence.occurrenceKey = "2026-09-27T16:00:00Z"
        var second = first; second.occurrence.occurrenceKey = "2026-10-04T16:00:00Z"
        let service = CalendarTestService(); service.load = NativeCalendarLoad(items: [first, second], isSyncing: false)
        let store = NativeCalendarStore(service: service)
        await store.refresh()
        let entry = try XCTUnwrap(store.entries.first { $0.id == first.id })
        await store.respond(entry, response: "accepted", scope: "this_event")
        XCTAssertEqual(service.rsvpCalls.last?.scope, "this_event")
        XCTAssertEqual(service.rsvpCalls.last?.recurrenceID, first.occurrence.occurrenceKey)
        XCTAssertEqual(store.items.first { $0.id == second.id }?.event.attendees.first?.responseStatus, "needs_action")
        await store.respond(entry, response: "declined", scope: "all")
        XCTAssertNil(service.rsvpCalls.last?.recurrenceID)
        XCTAssertTrue(store.items.allSatisfy { $0.event.attendees.first?.responseStatus == "declined" })
    }

    private func fixtureItem() -> NativeCalendarItem {
        let date = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date())!
        let time = NativeCalendarTime.timed(startsAt: MessageDate.string(date), endsAt: MessageDate.string(date.addingTimeInterval(3_600)), timeZone: TimeZone.current.identifier)
        let event = NativeCalendarEvent(id: "fixture-event", calendarId: "calendar", title: "Planning", isReadOnly: false,
            time: time, attendees: [], recurrenceLines: [], status: "confirmed")
        return NativeCalendarItem(event: event, occurrence: NativeCalendarOccurrence(eventId: event.id, occurrenceKey: "instance", isCancelled: false, time: time))
    }
    private func waitUntil(_ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(2)
        while !condition() && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(1)) }
        if !condition() { XCTFail("Expected calendar request did not start"); throw NativeCalendarError.invalidResponse }
    }
}

@MainActor
private final class CalendarTestService: NativeCalendarService {
    var sources = [NativeCalendarSource(id: "calendar", name: "Work", emailAddress: "me@example.com", emailLinkId: "inbox",
        isPrimary: true, isSubscription: false, isWritable: true)]
    var load = NativeCalendarLoad(items: [], isSyncing: false)
    var mutationFailure: Error?
    var rsvpCalls: [(scope: String, recurrenceID: String?)] = []
    var delayLoads = false
    var waiting: [CheckedContinuation<NativeCalendarLoad, Never>] = []
    func calendars() async throws -> [NativeCalendarSource] { sources }
    func occurrences(in range: NativeCalendarRange) async throws -> NativeCalendarLoad {
        if delayLoads { return await withCheckedContinuation { waiting.append($0) } }
        return load
    }
    func create(_ body: NativeCalendarMutation) async throws -> NativeCalendarEvent { throw mutationFailure ?? NativeCalendarError.invalidResponse }
    func update(_ id: String, body: NativeCalendarMutation) async throws -> NativeCalendarEvent { throw mutationFailure ?? NativeCalendarError.invalidResponse }
    func delete(_ id: String, calendarID: String?, scope: String, recurrenceID: String?) async throws { if let mutationFailure { throw mutationFailure } }
    func respond(_ id: String, calendarID: String?, response: String, scope: String, recurrenceID: String?) async throws -> NativeCalendarEvent {
        rsvpCalls.append((scope, recurrenceID))
        if let mutationFailure { throw mutationFailure }
        guard let event = load.items.first?.event else { throw NativeCalendarError.invalidResponse }
        return event
    }
}
