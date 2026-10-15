import Foundation

enum NativeCalendarDetailFormatting {
    static func safeURL(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
        return url
    }
    static func schedule(_ entry: NativeCalendarEntry, calendar: Calendar, use24Hour: Bool) -> String {
        let end = entry.isAllDay ? calendar.date(byAdding: .day, value: -1, to: entry.interval.end)! : entry.interval.end
        let date = DateFormatter(); date.calendar = calendar; date.timeZone = calendar.timeZone
        date.setLocalizedDateFormatFromTemplate("EEE MMMM d")
        let time = timeFormatter(zone: calendar.timeZone, use24Hour: use24Hour)
        if entry.isAllDay {
            if calendar.isDate(entry.interval.start, inSameDayAs: end) { return date.string(from: entry.interval.start) + " · All day" }
            date.setLocalizedDateFormatFromTemplate("MMM d")
            return date.string(from: entry.interval.start) + "–" + date.string(from: end) + " · All day"
        }
        if calendar.isDate(entry.interval.start, inSameDayAs: end) {
            return date.string(from: entry.interval.start) + " · " + time.string(from: entry.interval.start) + "–" + time.string(from: end)
        }
        return date.string(from: entry.interval.start) + ", " + time.string(from: entry.interval.start) + "–" + date.string(from: end) + ", " + time.string(from: end)
    }
    static func originalTime(_ date: Date, zone: String, use24Hour: Bool) -> String {
        guard let timeZone = TimeZone(identifier: zone) else { return "Original timezone: " + zone }
        let formatter = timeFormatter(zone: timeZone, use24Hour: use24Hour)
        return "Original time: " + formatter.string(from: date) + " " + (timeZone.abbreviation(for: date) ?? zone) + " · " + zone
    }
    private static func timeFormatter(zone: TimeZone, use24Hour: Bool) -> DateFormatter {
        let formatter = DateFormatter(); formatter.locale = .current; formatter.timeZone = zone
        formatter.dateFormat = use24Hour ? "HH:mm" : "h:mm a"
        return formatter
    }
    static func reminder(_ reminder: NativeCalendarReminder) -> String {
        let minutes = reminder.minutes
        let offset = minutes == 0 ? "At time of event" : minutes % 10_080 == 0 ? "\(minutes / 10_080) \(minutes == 10_080 ? "week" : "weeks") before" : minutes % 1_440 == 0 ? "\(minutes / 1_440) \(minutes == 1_440 ? "day" : "days") before" : minutes % 60 == 0 ? "\(minutes / 60) \(minutes == 60 ? "hour" : "hours") before" : "\(minutes) \(minutes == 1 ? "minute" : "minutes") before"
        return offset + (reminder.method == "popup" ? "" : " (email)")
    }
    static func recurrence(_ lines: [String]) -> String {
        guard let rule = lines.first(where: { $0.hasPrefix("RRULE:") }) else { return "Recurring event" }
        if rule.contains("FREQ=DAILY") { return "Daily" }
        if rule.contains("FREQ=WEEKLY") { return "Weekly" }
        if rule.contains("FREQ=MONTHLY") { return "Monthly" }
        if rule.contains("FREQ=YEARLY") { return "Yearly" }
        return "Recurring event"
    }
    static func mentionHTML(_ entry: NativeCalendarEntry) -> String {
        func escaped(_ value: String) -> String {
            value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        }
        var attributes = "data-document-mention=\"true\" data-document-id=\"\(escaped(entry.eventID))\" data-document-name=\"\(escaped(entry.title))\" data-block-name=\"calendar\""
        if entry.isRecurring, let data = try? JSONSerialization.data(withJSONObject: ["occurrenceKey": entry.item.occurrence.occurrenceKey]), let value = String(data: data, encoding: .utf8) {
            attributes += " data-block-params=\"\(escaped(value))\""
        }
        return "<span \(attributes)>\(escaped(entry.title))</span>"
    }
    static func link(_ entry: NativeCalendarEntry, baseURL: URL, period: NativeCalendarPeriod) -> URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("calendar/" + period.rawValue.lowercased()), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "s0.calendar.eventId", value: entry.eventID)]
        if entry.isRecurring { components.queryItems?.append(URLQueryItem(name: "s0.calendar.occurrenceKey", value: entry.item.occurrence.occurrenceKey)) }
        return components.url!
    }
}

struct NativeCalendarPerson: Equatable {
    var name: String?
    var email: String?
    var isSelf: Bool
    var label: String { name ?? email ?? "" }
}

extension NativeCalendarDetailFormatting {
    static func attribution(_ event: NativeCalendarEvent, source: NativeCalendarSource?) -> (creator: NativeCalendarPerson?, organizer: NativeCalendarPerson?) {
        let attendee = event.attendees.first(where: \.isOrganizer)
        let name = event.organizerName ?? attendee?.displayName
        let email = event.organizerEmail ?? attendee?.email
        let organizer = name != nil || email != nil ? NativeCalendarPerson(name: name, email: email, isSelf: attendee?.isSelf ?? false) : nil
        let creator = event.creatorName != nil || event.creatorEmail != nil ? NativeCalendarPerson(name: event.creatorName, email: event.creatorEmail,
            isSelf: event.attendees.contains { $0.isSelf && $0.email.caseInsensitiveCompare(event.creatorEmail ?? "") == .orderedSame }) : nil
        func matches(_ person: NativeCalendarPerson) -> Bool {
            guard let source else { return false }
            let calendarName = source.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if let name = person.name?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !name.isEmpty,
               calendarName == name || calendarName.hasPrefix(name + " —") { return true }
            if let email = person.email?.lowercased(), !email.isEmpty {
                if calendarName == email { return true }
                if source.isPrimary && source.emailAddress.lowercased() == email { return true }
            }
            return false
        }
        return (creator.flatMap { !matches($0) && (organizer == nil || matches(organizer!)) ? $0 : nil }, organizer.flatMap { matches($0) ? nil : $0 })
    }
    static func reminders(_ entry: NativeCalendarEntry, source: NativeCalendarSource?) -> [NativeCalendarReminder] {
        let settings = entry.copy?.reminders ?? entry.item.event.reminders
        let reminders: [NativeCalendarReminder]
        if let settings, !settings.useDefault { reminders = settings.overrides ?? [] }
        else if ["working_location", "out_of_office", "focus_time", "birthday"].contains(entry.copy?.eventType ?? entry.item.event.eventType ?? "") { reminders = [] }
        else { reminders = source?.defaultReminders ?? [] }
        return reminders.sorted { $0.minutes < $1.minutes }
    }
}
