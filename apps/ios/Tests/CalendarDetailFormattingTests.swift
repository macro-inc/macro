import XCTest
@testable import MacroNative

final class CalendarDetailFormattingTests: XCTestCase {
    func testCalendarOwnerIsNotRepeatedAndSharedCalendarCreatorIsPreserved() {
        var source = NativeCalendarSource(id: "work", name: "Alex — Team", emailAddress: "viewer@example.com", emailLinkId: "inbox", isPrimary: false, isSubscription: false, isWritable: true)
        var event = event()
        event.organizerName = "Alex"; event.organizerEmail = "alex@example.com"
        event.creatorName = "Viewer"; event.creatorEmail = "viewer@example.com"
        let shared = NativeCalendarDetailFormatting.attribution(event, source: source)
        XCTAssertNil(shared.organizer)
        XCTAssertEqual(shared.creator?.email, "viewer@example.com", "The viewer's inbox is not the shared calendar's owner")
        source.name = "viewer@example.com"; source.isPrimary = true
        event.organizerName = nil; event.organizerEmail = "viewer@example.com"
        let own = NativeCalendarDetailFormatting.attribution(event, source: source)
        XCTAssertNil(own.creator); XCTAssertNil(own.organizer)
    }

    func testReminderDefaultsFollowCalendarButStatusEventsAndExplicitNoneDoNot() {
        var source = NativeCalendarSource(id: "work", name: "Work", emailAddress: "alex@example.com", emailLinkId: "inbox", isPrimary: true, isSubscription: false, isWritable: true)
        source.defaultReminders = [.init(minutes: 10), .init(method: "email", minutes: 30)]
        var entry = entry()
        XCTAssertEqual(NativeCalendarDetailFormatting.reminders(entry, source: source), [.init(minutes: 10), .init(method: "email", minutes: 30)])
        entry.item.event.eventType = "out_of_office"
        XCTAssertTrue(NativeCalendarDetailFormatting.reminders(entry, source: source).isEmpty)
        entry.item.event.reminders = .init(useDefault: false, overrides: [.init(minutes: 5)])
        XCTAssertEqual(NativeCalendarDetailFormatting.reminders(entry, source: source), [.init(minutes: 5)])
        entry.item.event.reminders?.overrides = []
        XCTAssertTrue(NativeCalendarDetailFormatting.reminders(entry, source: source).isEmpty)
    }

    func testCopiedCalendarMentionEscapesMarkupAndPinsRecurringOccurrence() {
        var entry = entry()
        entry.item.event.title = "A \"title\" <script> & more"
        entry.item.event.recurrenceLines = ["RRULE:FREQ=DAILY"]
        let html = NativeCalendarDetailFormatting.mentionHTML(entry)
        XCTAssertFalse(html.contains("<script>"))
        XCTAssertTrue(html.contains("data-block-name=\"calendar\""))
        XCTAssertTrue(html.contains("&quot;title&quot; &lt;script&gt; &amp; more"))
        XCTAssertTrue(html.contains("occurrenceKey"))
    }

    private func event() -> NativeCalendarEvent {
        NativeCalendarEvent(id: "event", calendarId: "work", title: "Review", isReadOnly: false,
            time: .timed(startsAt: "2026-09-27T14:00:00Z", endsAt: "2026-09-27T15:00:00Z", timeZone: nil), attendees: [], recurrenceLines: [], status: "confirmed")
    }
    private func entry() -> NativeCalendarEntry {
        let event = event()
        return NativeCalendarEntry(item: NativeCalendarItem(event: event, occurrence: NativeCalendarOccurrence(eventId: event.id,
            occurrenceKey: "2026-09-27T14:00:00Z", isCancelled: false, time: event.time)), interval: event.time.interval()!)
    }
}
