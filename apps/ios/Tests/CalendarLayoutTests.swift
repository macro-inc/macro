import XCTest
@testable import MacroNative

final class CalendarLayoutTests: XCTestCase {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian); value.timeZone = TimeZone(identifier: "America/New_York")!; return value
    }
    func testOverlappingMeetingsUseSeparateLanesButLaterMeetingsRegainFullWidth() throws {
        let day = try XCTUnwrap(NativeCalendarDates.localDate("2026-09-28", calendar: calendar))
        let entries = [entry("a", day: day, start: 540, end: 600), entry("b", day: day, start: 570, end: 630),
                       entry("c", day: day, start: 600, end: 660), entry("d", day: day, start: 660, end: 690)]
        let placements = NativeCalendarLayout.placements(entries, on: day, calendar: calendar)
        XCTAssertEqual(placements.map(\.column), [0, 1, 0, 0])
        XCTAssertEqual(placements.map(\.columns), [2, 2, 2, 1])
    }
    func testWallClockPositionsStayCorrectOnSpringAndFallDSTDays() throws {
        for date in ["2026-03-08", "2026-11-01"] {
            let day = try XCTUnwrap(NativeCalendarDates.localDate(date, calendar: calendar))
            let meeting = entry("morning", day: day, start: 540, end: 600)
            let placement = try XCTUnwrap(NativeCalendarLayout.placements([meeting], on: day, calendar: calendar).first)
            XCTAssertEqual(placement.startMinute, 540)
            XCTAssertEqual(placement.endMinute, 600)
            let tomorrow = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: day))
            XCTAssertEqual(NativeCalendarLayout.minute(tomorrow, on: day, calendar: calendar), 1_440)
        }
    }
    func testOvernightMeetingClipsToEachDayAndAllDayStaysOutOfTimeGrid() throws {
        let day = try XCTUnwrap(NativeCalendarDates.localDate("2026-09-28", calendar: calendar))
        let tomorrow = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: day))
        var overnight = entry("overnight", day: day, start: 1_380, end: 1_440)
        overnight.interval = DateInterval(start: overnight.interval.start, end: tomorrow.addingTimeInterval(3_600))
        var allDay = entry("all-day", day: day, start: 0, end: 1_440)
        allDay.item.occurrence.time = .allDay(startDate: "2026-09-28", endDate: "2026-09-29")
        let first = NativeCalendarLayout.placements([overnight, allDay], on: day, calendar: calendar)
        XCTAssertEqual(first.count, 1); XCTAssertEqual(first.first?.endMinute, 1_440)
        let second = NativeCalendarLayout.placements([overnight], on: tomorrow, calendar: calendar)
        XCTAssertEqual(second.first?.startMinute, 0); XCTAssertEqual(second.first?.endMinute, 60)
    }
    func testAllDayBandsSpanMultipleDaysAndReuseUnoccupiedLanes() throws {
        let day = try XCTUnwrap(NativeCalendarDates.localDate("2026-09-28", calendar: calendar))
        let days = (0..<7).map { calendar.date(byAdding: .day, value: $0, to: day)! }
        func allDay(_ id: String, first: Int, last: Int) -> NativeCalendarEntry {
            var value = entry(id, day: day, start: 0, end: 1_440)
            value.interval = DateInterval(start: days[first], end: calendar.date(byAdding: .day, value: last + 1, to: day)!)
            value.item.occurrence.time = .allDay(startDate: NativeCalendarDates.dateString(value.interval.start, calendar: calendar), endDate: NativeCalendarDates.dateString(value.interval.end, calendar: calendar))
            return value
        }
        let bands = NativeCalendarMonthBand.layout([allDay("long", first: 0, last: 3), allDay("overlap", first: 1, last: 2), allDay("later", first: 4, last: 5)], days: days, calendar: calendar)
        XCTAssertEqual(bands.map(\.startColumn), [0, 1, 4])
        XCTAssertEqual(bands.map(\.endColumn), [3, 2, 5])
        XCTAssertEqual(bands.map(\.lane), [0, 1, 0])
    }

    private func entry(_ id: String, day: Date, start: Int, end: Int) -> NativeCalendarEntry {
        func time(_ minute: Int) -> Date {
            if minute == 1_440 { return calendar.date(byAdding: .day, value: 1, to: day)! }
            return calendar.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: day)!
        }
        let begin = time(start); let finish = time(end)
        let span = NativeCalendarTime.timed(startsAt: MessageDate.string(begin), endsAt: MessageDate.string(finish), timeZone: calendar.timeZone.identifier)
        let event = NativeCalendarEvent(id: id, calendarId: "work", title: id, isReadOnly: false, time: span, attendees: [], recurrenceLines: [], status: "confirmed")
        let occurrence = NativeCalendarOccurrence(eventId: id, occurrenceKey: id, isCancelled: false, time: span)
        return NativeCalendarEntry(item: NativeCalendarItem(event: event, occurrence: occurrence), interval: DateInterval(start: begin, end: finish))
    }
}
