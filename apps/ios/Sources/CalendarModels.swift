import Foundation

struct NativeCalendarSource: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var emailAddress: String
    var emailLinkId: String
    var isPrimary: Bool
    var isSubscription: Bool
    var isWritable: Bool
    var color: String?
    var syncError: String?
    var defaultReminders: [NativeCalendarReminder]?
}

struct NativeCalendarAttendee: Codable, Identifiable, Equatable {
    var email: String
    var displayName: String?
    var isOptional: Bool = false
    var isOrganizer: Bool = false
    var isSelf: Bool = false
    var responseStatus: String = "needs_action"
    var id: String { email }
    var label: String { displayName?.isEmpty == false ? displayName! : email }
}

struct NativeCalendarReminder: Codable, Equatable {
    var method: String = "popup"
    var minutes: Int
}

struct NativeCalendarReminders: Codable, Equatable {
    var useDefault: Bool = true
    var overrides: [NativeCalendarReminder]? = nil
}

enum NativeCalendarTime: Codable, Equatable {
    case timed(startsAt: String, endsAt: String, timeZone: String?)
    case allDay(startDate: String, endDate: String)

    private enum CodingKeys: String, CodingKey { case kind, startsAt, endsAt, timeZone, startDate, endDate }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(String.self, forKey: .kind) {
        case "timed": self = .timed(startsAt: try values.decode(String.self, forKey: .startsAt),
            endsAt: try values.decode(String.self, forKey: .endsAt), timeZone: try values.decodeIfPresent(String.self, forKey: .timeZone))
        case "allDay": self = .allDay(startDate: try values.decode(String.self, forKey: .startDate),
            endDate: try values.decode(String.self, forKey: .endDate))
        default: throw DecodingError.dataCorruptedError(forKey: .kind, in: values, debugDescription: "Unknown event time.")
        }
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .timed(start, end, zone):
            try values.encode("timed", forKey: .kind)
            try values.encode(start, forKey: .startsAt); try values.encode(end, forKey: .endsAt)
            try values.encodeIfPresent(zone, forKey: .timeZone)
        case let .allDay(start, end):
            try values.encode("allDay", forKey: .kind)
            try values.encode(start, forKey: .startDate); try values.encode(end, forKey: .endDate)
        }
    }
    var isAllDay: Bool { if case .allDay = self { return true }; return false }
    var zone: String? { if case let .timed(_, _, zone) = self { return zone }; return nil }
    func interval(calendar: Calendar = .current) -> DateInterval? {
        let start: Date?
        let end: Date?
        switch self {
        case let .timed(first, last, _):
            start = MessageDate.parse(first); end = MessageDate.parse(last)
        case let .allDay(first, last):
            start = NativeCalendarDates.localDate(first, calendar: calendar)
            end = NativeCalendarDates.localDate(last, calendar: calendar)
        }
        guard let start, let end, start != .distantPast, end > start else { return nil }
        return DateInterval(start: start, end: end)
    }
}

struct NativeCalendarCopy: Codable {
    var calendarId: String
    var title: String
    var description: String?
    var location: String?
    var isReadOnly: Bool
    var eventType: String?
    var transparency: String?
    var visibility: String?
    var reminders: NativeCalendarReminders?
}

struct NativeCalendarEvent: Codable, Identifiable {
    var id: String
    var calendarId: String?
    var title: String
    var description: String?
    var location: String?
    var isReadOnly: Bool
    var time: NativeCalendarTime
    var attendees: [NativeCalendarAttendee]
    var recurrenceLines: [String]
    var status: String
    var organizerName: String?
    var organizerEmail: String?
    var creatorName: String?
    var creatorEmail: String?
    var conferenceUrl: String?
    var conferenceProvider: String?
    var sources: [NativeCalendarCopy]?
    var eventType: String?
    var transparency: String?
    var visibility: String?
    var reminders: NativeCalendarReminders?
}

struct NativeCalendarOccurrence: Codable {
    var eventId: String
    var occurrenceKey: String
    var recurrenceId: String?
    var isCancelled: Bool
    var time: NativeCalendarTime
}

struct NativeCalendarItem: Codable, Identifiable {
    var event: NativeCalendarEvent
    var occurrence: NativeCalendarOccurrence
    var id: String { event.id + "|" + occurrence.occurrenceKey }
}

struct NativeCalendarPage: Codable {
    var items: [NativeCalendarItem]
    var hasMore: Bool
    var nextCursor: String?
    var syncStatus: String
}

struct NativeCalendarEntry: Identifiable {
    var item: NativeCalendarItem
    var copy: NativeCalendarCopy?
    var interval: DateInterval
    var id: String { item.id }
    var eventID: String { item.event.id }
    var calendarID: String? { copy?.calendarId ?? item.event.calendarId }
    var title: String { let value = copy?.title ?? item.event.title; return value.isEmpty ? "Untitled event" : value }
    var description: String? { copy?.description ?? item.event.description }
    var location: String? { copy?.location ?? item.event.location }
    var isReadOnly: Bool { copy?.isReadOnly ?? item.event.isReadOnly }
    var isRecurring: Bool { !item.event.recurrenceLines.isEmpty || item.occurrence.recurrenceId != nil }
    var isAllDay: Bool { item.occurrence.time.isAllDay }
}

enum NativeCalendarPeriod: String, CaseIterable, Identifiable {
    case month = "Month", week = "Week", day = "Day"
    var id: String { rawValue }
}

struct NativeCalendarRange: Equatable {
    let start: Date
    let end: Date
    let startDate: String
    let endDate: String

    init(start: Date, end: Date, calendar: Calendar = .current) {
        self.start = start; self.end = end
        startDate = NativeCalendarDates.dateString(start, calendar: calendar)
        endDate = NativeCalendarDates.dateString(end, calendar: calendar)
    }
}

enum NativeCalendarDates {
    static func dateString(_ date: Date, calendar: Calendar = .current) -> String {
        let values = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", values.year ?? 0, values.month ?? 0, values.day ?? 0)
    }
    static func localDate(_ value: String, calendar: Calendar = .current) -> Date? {
        let values = value.split(separator: "-").compactMap { Int($0) }
        guard values.count == 3 else { return nil }
        var parts = DateComponents(); parts.year = values[0]; parts.month = values[1]; parts.day = values[2]
        guard let result = calendar.date(from: parts), dateString(result, calendar: calendar) == value else { return nil }
        return result
    }
    static func range(containing date: Date, period: NativeCalendarPeriod, calendar: Calendar = .current) -> NativeCalendarRange {
        let component: Calendar.Component = period == .month ? .month : period == .week ? .weekOfYear : .day
        let interval = calendar.dateInterval(of: component, for: date)!
        if period == .month {
            let start = calendar.dateInterval(of: .weekOfYear, for: interval.start)!.start
            let lastDay = calendar.date(byAdding: .day, value: -1, to: interval.end)!
            let end = calendar.dateInterval(of: .weekOfYear, for: lastDay)!.end
            return NativeCalendarRange(start: start, end: end, calendar: calendar)
        }
        return NativeCalendarRange(start: interval.start, end: interval.end, calendar: calendar)
    }
    static func days(in range: NativeCalendarRange, calendar: Calendar = .current) -> [Date] {
        var days: [Date] = []; var date = range.start
        while date < range.end, days.count < 50 {
            days.append(date)
            guard let next = calendar.date(byAdding: .day, value: 1, to: date) else { break }
            date = next
        }
        return days
    }
    static func supported(_ range: NativeCalendarRange, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        let today = calendar.startOfDay(for: now)
        let first = calendar.date(byAdding: .day, value: -364, to: today)!
        let last = calendar.date(byAdding: .day, value: 729, to: today)!
        return range.start >= first && range.end <= last
    }
}

struct NativeCalendarGuestInput: Codable, Equatable { var email: String; var isOptional: Bool = false }

struct NativeCalendarMutation: Encodable {
    var calendarId: String?
    var title: String?
    var description: String?
    var location: String?
    var time: NativeCalendarTime?
    var attendees: [NativeCalendarGuestInput]?
    var recurrenceLines: [String]?
    var scope: String?
    var recurrenceId: String?
    var conference: String?
    var transparency: String?
    var visibility: String?
    var reminders: NativeCalendarReminders?
}

enum NativeCalendarError: LocalizedError {
    case invalidResponse, invalidPagination, invalidDates, missingCalendar, invalidGuests, unsupportedRange
    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Calendar data could not be read. Try refreshing."
        case .invalidPagination: "Calendar could not finish loading. Pull to refresh."
        case .invalidDates: "The event must end after it starts."
        case .missingCalendar: "Choose a writable calendar for this event."
        case .invalidGuests: "Enter guest email addresses separated by commas."
        case .unsupportedRange: "Macro shows calendar events from the past year through the next two years."
        }
    }
}
