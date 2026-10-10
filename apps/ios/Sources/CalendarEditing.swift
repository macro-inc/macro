import Foundation

struct NativeCalendarDraft {
    var title = ""
    var calendarID = ""
    var location = ""
    var notes = ""
    var guests = ""
    var allDay = false
    var start: Date
    /// Last included day for all-day editing; conversion adds one calendar day, never 86,400 seconds.
    var end: Date
    var timeZone = TimeZone.current.identifier
    var scope = "this_event"
    var recurrence = ""
    var addGoogleMeet = false
    var availability = "opaque"
    var visibility = "default"
    var reminderMinutes = -1
    private var originalGuests: [NativeCalendarAttendee] = []
    private var originalReminderChoice = -1

    init(date: Date, calendarID: String, calendar: Calendar = .current) {
        let components = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        let rounded = calendar.date(from: components) ?? date
        start = rounded; end = rounded.addingTimeInterval(3_600); self.calendarID = calendarID
    }
    init(entry: NativeCalendarEntry, calendar: Calendar = .current) {
        title = entry.title; calendarID = entry.calendarID ?? ""; location = entry.location ?? ""
        notes = NativeCalendarText.plain(entry.description ?? ""); allDay = entry.isAllDay; start = entry.interval.start
        end = entry.isAllDay ? calendar.date(byAdding: .day, value: -1, to: entry.interval.end)! : entry.interval.end
        timeZone = entry.item.occurrence.time.zone ?? TimeZone.current.identifier
        scope = entry.isRecurring ? "this_event" : "all"
        originalGuests = entry.item.event.attendees
        guests = originalGuests.filter { !$0.isOrganizer && !$0.isSelf }.map(\.email).joined(separator: ", ")
        availability = entry.copy?.transparency ?? entry.item.event.transparency ?? "opaque"
        visibility = entry.copy?.visibility ?? entry.item.event.visibility ?? "default"
        let reminders = entry.copy?.reminders ?? entry.item.event.reminders
        if reminders?.useDefault == false { reminderMinutes = reminders?.overrides?.first?.minutes ?? -2 }
        originalReminderChoice = reminderMinutes
    }

    func mutation(editing entry: NativeCalendarEntry?, calendar: Calendar = .current) throws -> NativeCalendarMutation {
        guard !calendarID.isEmpty else { throw NativeCalendarError.missingCalendar }
        let cleanedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var local = calendar
        if let zone = TimeZone(identifier: timeZone) { local.timeZone = zone }
        let time: NativeCalendarTime
        if allDay {
            let first = calendar.startOfDay(for: start)
            guard let last = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: end)), last > first else { throw NativeCalendarError.invalidDates }
            time = .allDay(startDate: NativeCalendarDates.dateString(first, calendar: calendar), endDate: NativeCalendarDates.dateString(last, calendar: calendar))
        } else {
            guard end > start, TimeZone(identifier: timeZone) != nil else { throw NativeCalendarError.invalidDates }
            time = .timed(startsAt: MessageDate.string(start), endsAt: MessageDate.string(end), timeZone: local.timeZone.identifier)
        }
        let tokens = guests.components(separatedBy: CharacterSet(charactersIn: ",;\n")).map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty }
        guard tokens.allSatisfy({ value in
            let parts = value.split(separator: "@", omittingEmptySubsequences: false)
            return parts.count == 2 && !parts[0].isEmpty && parts[1].contains(".") && !value.contains(where: \.isWhitespace)
        }) else { throw NativeCalendarError.invalidGuests }
        // Retain organizer/self and existing optional flags when editing the guest list.
        var attendeeEmails = Set(tokens)
        if entry != nil { attendeeEmails.formUnion(originalGuests.filter { $0.isOrganizer || $0.isSelf }.map(\.email)) }
        let attendees = attendeeEmails.sorted().map { email in
            NativeCalendarGuestInput(email: email, isOptional: originalGuests.first { $0.email == email }?.isOptional ?? false)
        }
        let previousGuestEmails = Set(originalGuests.filter { !$0.isOrganizer && !$0.isSelf }.map { $0.email.lowercased() })
        let changeGuests = entry == nil || (entry.map(Self.canEditGuests) == true && previousGuestEmails != Set(tokens))
        let reminders: NativeCalendarReminders
        if reminderMinutes == -1 { reminders = NativeCalendarReminders(useDefault: true) }
        else { reminders = NativeCalendarReminders(useDefault: false, overrides: reminderMinutes == -2 ? [] : [NativeCalendarReminder(minutes: reminderMinutes)]) }
        let changedTime = entry.map { current in
            current.isAllDay != allDay || current.interval.start != start ||
                (allDay ? calendar.date(byAdding: .day, value: -1, to: current.interval.end)! : current.interval.end) != end ||
                (current.item.occurrence.time.zone ?? TimeZone.current.identifier) != timeZone
        } ?? true
        let includeTime = changedTime && (entry?.isRecurring != true || scope == "this_event")
        return NativeCalendarMutation(calendarId: calendarID, title: entry?.title == cleanedTitle ? nil : cleanedTitle,
            description: entry.map { NativeCalendarText.plain($0.description ?? "") == notes } == true ? nil : notes,
            location: entry.map { ($0.location ?? "") == location } == true ? nil : location,
            time: includeTime ? time : nil, attendees: changeGuests ? attendees : nil,
            recurrenceLines: entry == nil ? (recurrence.isEmpty ? [] : ["RRULE:FREQ=\(recurrence)"]) : nil,
            scope: entry == nil ? nil : scope, recurrenceId: entry != nil && scope == "this_event" ? (entry?.item.occurrence.recurrenceId ?? (entry?.isRecurring == true ? entry?.item.occurrence.occurrenceKey : nil)) : nil,
            conference: addGoogleMeet ? "google_meet" : nil,
            transparency: entry.map { ($0.copy?.transparency ?? $0.item.event.transparency ?? "opaque") == availability } == true ? nil : availability,
            visibility: entry.map { ($0.copy?.visibility ?? $0.item.event.visibility ?? "default") == visibility } == true ? nil : visibility,
            reminders: entry != nil && reminderMinutes == originalReminderChoice ? nil : reminders)
    }

    static func canEditGuests(_ entry: NativeCalendarEntry) -> Bool {
        if let organizer = entry.item.event.attendees.first(where: \.isOrganizer) { return organizer.isSelf }
        return entry.item.event.attendees.isEmpty
    }
}

enum NativeCalendarText {
    static func plain(_ text: String) -> String {
        var value = text.replacingOccurrences(of: "(?i)<br\\s*/?>|</(?:p|div|li)>", with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (entity, replacement) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&")] {
            value = value.replacingOccurrences(of: entity, with: replacement)
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
