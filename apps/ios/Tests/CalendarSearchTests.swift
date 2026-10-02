import XCTest
@testable import MacroNative

@MainActor
final class CalendarSearchTests: XCTestCase {
    func testRecurringSearchOpensResolvedOccurrenceInsteadOfOldMasterDate() {
        let item = WorkspaceItem(id: "series", kind: .calendar, title: "Standup", payload: .object([
            "metadata": .object([
                "time": .object(["startsAt": .string("2021-01-01T14:00:00Z")]),
                "occurrence": .object(["occurrenceKey": .string("2026-09-28T14:00:00Z"), "time": .object([
                    "startsAt": .string("2026-09-28T14:00:00Z"), "endsAt": .string("2026-09-28T14:30:00Z"),
                ])]),
            ]),
        ]))
        XCTAssertEqual(NativeCalendarSearchSheet.occurrenceKey(for: item), "2026-09-28T14:00:00Z")
        XCTAssertEqual(NativeCalendarSearchSheet.date(for: item, calendar: .current), MessageDate.parse("2026-09-28T14:00:00Z"))
    }
    func testAllDaySearchDateUsesLocalTimeZone() throws {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/New_York")!
        let item = WorkspaceItem(id: "holiday", kind: .calendar, title: "Day off", payload: .object([
            "metadata": .object(["time": .object(["kind": .string("allDay"), "startDate": .string("2026-09-28"), "endDate": .string("2026-09-29")])]),
        ]))
        let date = try XCTUnwrap(NativeCalendarSearchSheet.date(for: item, calendar: calendar))
        XCTAssertEqual(MessageDate.string(date), "2026-09-28T04:00:00.000Z")
    }
}
