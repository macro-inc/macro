import SwiftUI

/// Wall-clock placement keeps 9 AM at the same position even across daylight-saving changes.
struct NativeCalendarEventPlacement: Identifiable {
    let entry: NativeCalendarEntry
    let startMinute: Double
    let endMinute: Double
    var column: Int = 0
    var columns: Int = 1
    var id: String { entry.id }
}

enum NativeCalendarLayout {
    static func minute(_ date: Date, on day: Date, calendar: Calendar) -> Double {
        let interval = calendar.dateInterval(of: .day, for: day)!
        if date <= interval.start { return 0 }
        if date >= interval.end { return 1_440 }
        let parts = calendar.dateComponents([.hour, .minute, .second], from: date)
        return Double((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) + Double(parts.second ?? 0) / 60
    }

    static func placements(_ entries: [NativeCalendarEntry], on day: Date, calendar: Calendar) -> [NativeCalendarEventPlacement] {
        let dayInterval = calendar.dateInterval(of: .day, for: day)!
        var result = entries.filter { !$0.isAllDay && $0.interval.start < dayInterval.end && $0.interval.end > dayInterval.start }
            .map { entry in
                NativeCalendarEventPlacement(entry: entry, startMinute: minute(entry.interval.start, on: day, calendar: calendar),
                    endMinute: minute(entry.interval.end, on: day, calendar: calendar))
            }.sorted { lhs, rhs in
                if lhs.startMinute != rhs.startMinute { return lhs.startMinute < rhs.startMinute }
                if lhs.endMinute != rhs.endMinute { return lhs.endMinute > rhs.endMinute }
                return lhs.id < rhs.id
            }
        var cluster: [Int] = []; var ends: [Double] = []; var clusterEnd: Double = -1
        func finishCluster() {
            for index in cluster { result[index].columns = ends.count }
        }
        for index in result.indices {
            let start = result[index].startMinute
            if start >= clusterEnd { finishCluster(); cluster = []; ends = [] }
            let column = ends.firstIndex(where: { $0 <= start }) ?? ends.count
            let end = max(result[index].endMinute, start + 15)
            if column == ends.count { ends.append(end) } else { ends[column] = end }
            result[index].column = column
            cluster.append(index); clusterEnd = max(clusterEnd, end)
        }
        finishCluster()
        return result
    }
}

struct NativeCalendarTimeGrid: View {
    let store: NativeCalendarStore
    let showWeekends: Bool
    let use24Hour: Bool
    let onSelect: (NativeCalendarEntry) -> Void
    private let hourHeight: CGFloat = 64
    private let gutter: CGFloat = 44
    private var days: [Date] {
        NativeCalendarDates.days(in: store.range, calendar: store.calendar).filter { store.period == .day || showWeekends || !store.calendar.isDateInWeekend($0) }
    }

    var body: some View {
        let entries = store.entries
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: gutter)
                ForEach(days, id: \.self) { day in dayHeading(day).frame(maxWidth: .infinity) }
            }.frame(height: 62).padding(.bottom, 7)
            allDayRow(entries: entries)
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    ZStack(alignment: .topLeading) {
                        hourLines
                        GeometryReader { geometry in
                            let dayWidth = max(1, (geometry.size.width - gutter) / CGFloat(max(1, days.count)))
                            ForEach(Array(days.enumerated()), id: \.element) { index, day in
                                Rectangle().fill(Color.primary.opacity(0.055)).frame(width: 0.5, height: hourHeight * 24)
                                    .offset(x: gutter + CGFloat(index) * dayWidth)
                                ForEach(NativeCalendarLayout.placements(entries, on: day, calendar: store.calendar)) { placement in
                                    event(placement, day: day, width: dayWidth)
                                        .offset(x: gutter + CGFloat(index) * dayWidth + CGFloat(placement.column) * dayWidth / CGFloat(placement.columns) + 1,
                                                y: CGFloat(placement.startMinute) / 60 * hourHeight)
                                }
                            }
                            TimelineView(.periodic(from: .now, by: 60)) { context in
                                if let today = days.firstIndex(where: { store.calendar.isDate($0, inSameDayAs: context.date) }) {
                                    let minute = NativeCalendarLayout.minute(context.date, on: days[today], calendar: store.calendar)
                                    HStack(spacing: 0) { Circle().frame(width: 5, height: 5); Rectangle().frame(height: 1) }
                                        .foregroundStyle(MacroTheme.accent).frame(width: dayWidth)
                                        .offset(x: gutter + CGFloat(today) * dayWidth, y: CGFloat(minute) / 60 * hourHeight - 2)
                                        .allowsHitTesting(false).accessibilityHidden(true)
                                }
                            }
                        }
                    }.frame(height: hourHeight * 24 + 12)
                }
                .nativeChromeInset()
                .refreshable { await store.refresh(reloadSources: true) }
                .accessibilityIdentifier("calendar-time-grid")
                .onAppear { proxy.scrollTo(8, anchor: .top) }
                .onChange(of: store.period) { _, _ in proxy.scrollTo(8, anchor: .top) }
            }
        }
    }

    private func dayHeading(_ day: Date) -> some View {
        let today = store.calendar.isDateInToday(day)
        return Button {
            if store.period == .week { store.focusDate = day; store.period = .day }
        } label: {
            VStack(spacing: 3) {
                Text(day.formatted(.dateTime.weekday(store.period == .day ? .abbreviated : .narrow)))
                    .font(.system(size: 13)).foregroundStyle(today ? MacroTheme.accent : .secondary)
                Text(String(store.calendar.component(.day, from: day))).font(.system(size: store.period == .day ? 24 : 20))
                    .frame(width: 33, height: 31)
                    .foregroundStyle(today ? Color(uiColor: .systemBackground) : .primary)
                    .background(today ? MacroTheme.accent : .clear, in: RoundedRectangle(cornerRadius: 8))
            }.frame(maxWidth: .infinity)
        }.buttonStyle(.plain).accessibilityLabel(day.formatted(date: .complete, time: .omitted))
            .accessibilityIdentifier("calendar-day-\(NativeCalendarDates.dateString(day, calendar: store.calendar))")
    }

    private var hourLines: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                HStack(alignment: .top, spacing: 0) {
                    Text(hourLabel(hour)).font(.system(size: 10)).foregroundStyle(.tertiary)
                        .frame(width: gutter - 6, alignment: .trailing).padding(.trailing, 6).offset(y: -6)
                    Rectangle().fill(Color.primary.opacity(0.055)).frame(height: 0.5)
                }.frame(height: hourHeight, alignment: .top).id(hour)
            }
        }.padding(.top, 1).accessibilityHidden(true)
    }
    private func hourLabel(_ hour: Int) -> String {
        if use24Hour { return String(format: "%02d:00", hour) }
        return "\(hour % 12 == 0 ? 12 : hour % 12)\(hour < 12 ? "am" : "pm")"
    }

    private func allDayRow(entries: [NativeCalendarEntry]) -> some View {
        let bands = NativeCalendarMonthBand.layout(entries, days: days, calendar: store.calendar)
        let count = (bands.map(\.lane).max() ?? -1) + 1
        let height = max(48, CGFloat(count) * 20 + 8)
        return GeometryReader { geometry in
            let dayWidth = max(1, (geometry.size.width - gutter) / CGFloat(max(1, days.count)))
            ForEach(bands) { band in
                NativeCalendarChip(entry: band.entry, color: NativeCalendarColors.color(store.source(id: band.entry.calendarID)?.color), compact: true) { onSelect(band.entry) }
                    .frame(width: max(1, CGFloat(band.endColumn - band.startColumn + 1) * dayWidth - 3))
                    .offset(x: gutter + CGFloat(band.startColumn) * dayWidth + 1, y: CGFloat(band.lane) * 20 + 3)
            }
        }.frame(height: height).overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.08)).frame(height: 0.5) }
    }
    private func overlaps(_ entry: NativeCalendarEntry, day: Date) -> Bool {
        let interval = store.calendar.dateInterval(of: .day, for: day)!
        return entry.interval.start < interval.end && entry.interval.end > interval.start
    }

    private func event(_ placement: NativeCalendarEventPlacement, day: Date, width: CGFloat) -> some View {
        let entry = placement.entry
        let color = NativeCalendarColors.color(store.source(id: entry.calendarID)?.color)
        let height = max(16, CGFloat(placement.endMinute - placement.startMinute) / 60 * hourHeight - 1)
        let eventWidth = max(8, width / CGFloat(placement.columns) - 3)
        return Button { onSelect(entry) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.system(size: 11, weight: .medium)).lineLimit(1)
                if store.period == .day && height > 28 {
                    Text(timeRange(entry)).font(.system(size: 10)).opacity(0.85).lineLimit(1)
                }
                if store.period == .day && height > 55, let location = entry.location, !location.isEmpty {
                    Text(location).font(.system(size: 10)).opacity(0.8).lineLimit(1)
                }
                Spacer(minLength: 0)
            }.padding(.horizontal, 4).padding(.vertical, 3)
                .frame(width: eventWidth, height: height, alignment: .topLeading)
                .background(NativeCalendarColors.eventFill(color), in: RoundedRectangle(cornerRadius: 5))
                .foregroundStyle(Color(white: 0.086)).clipped()
                .opacity(entry.item.event.attendees.first(where: \.isSelf)?.responseStatus == "declined" ? 0.45 : 1)
        }.buttonStyle(.plain)
            .accessibilityLabel("\(entry.title), \(entry.interval.start.formatted(date: .abbreviated, time: .shortened)) to \(entry.interval.end.formatted(date: .omitted, time: .shortened))")
            .accessibilityIdentifier("calendar-event-\(entry.eventID)")
    }
    private func timeRange(_ entry: NativeCalendarEntry) -> String {
        let formatter = DateFormatter(); formatter.timeZone = store.calendar.timeZone
        formatter.dateFormat = use24Hour ? "HH:mm" : "h:mm a"
        return formatter.string(from: entry.interval.start) + " – " + formatter.string(from: entry.interval.end)
    }
}

struct NativeCalendarMonthGrid: View {
    let store: NativeCalendarStore
    let showWeekends: Bool
    let onSelect: (NativeCalendarEntry) -> Void
    var body: some View {
        let allDays = NativeCalendarDates.days(in: store.range, calendar: store.calendar)
        let weeks = stride(from: 0, to: allDays.count, by: 7).map { Array(allDays[$0..<min($0 + 7, allDays.count)]).filter { showWeekends || !store.calendar.isDateInWeekend($0) } }
        let entries = store.entries
        GeometryReader { geometry in
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(weeks.first ?? [], id: \.self) { day in
                        Text(day.formatted(.dateTime.weekday(.narrow))).font(.system(size: 12)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                    }
                }.frame(height: 28)
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(weeks.indices, id: \.self) { index in
                            monthWeek(weeks[index], entries: entries, minimumHeight: max(64, (geometry.size.height - 28) / CGFloat(max(1, weeks.count))))
                        }
                    }
                }.nativeChromeInset().refreshable { await store.refresh(reloadSources: true) }.accessibilityIdentifier("calendar-month-grid")
            }
        }
    }
    private func monthWeek(_ days: [Date], entries: [NativeCalendarEntry], minimumHeight: CGFloat) -> some View {
        let bands = NativeCalendarMonthBand.layout(entries, days: days, calendar: store.calendar)
        let bandCount = (bands.map(\.lane).max() ?? -1) + 1
        let timed = days.map { day in entries.filter { !$0.isAllDay && overlaps($0, day: day) } }
        let maxTimed = timed.map(\.count).max() ?? 0
        let height = max(minimumHeight, 31 + CGFloat(bandCount + maxTimed) * 18 + 8)
        return ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.element) { index, day in
                    VStack(spacing: 2) {
                        dayButton(day)
                        Color.clear.frame(height: CGFloat(bandCount) * 18)
                        ForEach(timed[index]) { entry in
                            NativeCalendarChip(entry: entry, color: NativeCalendarColors.color(store.source(id: entry.calendarID)?.color), compact: false) { onSelect(entry) }
                        }
                        Spacer(minLength: 0)
                    }.padding(.horizontal, 1).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .overlay(alignment: .leading) { Rectangle().fill(Color.primary.opacity(0.05)).frame(width: 0.5) }
                }
            }
            GeometryReader { geometry in
                let dayWidth = geometry.size.width / CGFloat(max(1, days.count))
                ForEach(bands) { band in
                    NativeCalendarChip(entry: band.entry, color: NativeCalendarColors.color(store.source(id: band.entry.calendarID)?.color), compact: true) { onSelect(band.entry) }
                        .frame(width: max(1, CGFloat(band.endColumn - band.startColumn + 1) * dayWidth - 3))
                        .offset(x: CGFloat(band.startColumn) * dayWidth + 1, y: 31 + CGFloat(band.lane) * 18)
                }
            }
        }.frame(height: height).overlay(alignment: .top) { Rectangle().fill(Color.primary.opacity(0.07)).frame(height: 0.5) }
    }
    private func dayButton(_ day: Date) -> some View {
        let today = store.calendar.isDateInToday(day)
        let inMonth = store.calendar.isDate(day, equalTo: store.focusDate, toGranularity: .month)
        return Button { store.focusDate = day; store.period = .day } label: {
            Text(String(store.calendar.component(.day, from: day))).font(.system(size: 12, weight: today ? .semibold : .regular))
                .frame(width: 24, height: 23).foregroundStyle(inMonth ? Color.primary : Color.secondary.opacity(0.4))
                .overlay { if today { RoundedRectangle(cornerRadius: 6).stroke(MacroTheme.accent, lineWidth: 1) } }
                .frame(maxWidth: .infinity).frame(height: 27)
        }.buttonStyle(.plain).accessibilityLabel(day.formatted(date: .complete, time: .omitted))
            .accessibilityIdentifier("calendar-day-\(NativeCalendarDates.dateString(day, calendar: store.calendar))")
    }
    private func overlaps(_ entry: NativeCalendarEntry, day: Date) -> Bool {
        let interval = store.calendar.dateInterval(of: .day, for: day)!
        return entry.interval.start < interval.end && entry.interval.end > interval.start
    }
}

struct NativeCalendarMonthBand: Identifiable {
    let entry: NativeCalendarEntry
    let startColumn: Int
    let endColumn: Int
    let lane: Int
    var id: String { entry.id }
    static func layout(_ entries: [NativeCalendarEntry], days: [Date], calendar: Calendar) -> [Self] {
        var result: [Self] = []; var occupied: [Int] = []
        for entry in entries.filter(\.isAllDay).sorted(by: { $0.interval.start == $1.interval.start ? $0.interval.end > $1.interval.end : $0.interval.start < $1.interval.start }) {
            let columns = days.indices.filter { index in
                let interval = calendar.dateInterval(of: .day, for: days[index])!
                return entry.interval.start < interval.end && entry.interval.end > interval.start
            }
            guard let first = columns.first, let last = columns.last else { continue }
            let mask = columns.reduce(0) { $0 | (1 << $1) }
            let lane = occupied.firstIndex(where: { $0 & mask == 0 }) ?? occupied.count
            if lane == occupied.count { occupied.append(mask) } else { occupied[lane] |= mask }
            result.append(Self(entry: entry, startColumn: first, endColumn: last, lane: lane))
        }
        return result
    }
}

private struct NativeCalendarChip: View {
    let entry: NativeCalendarEntry
    let color: Color
    let compact: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 2) {
                if !compact { Circle().fill(color).frame(width: 4, height: 4) }
                Text(entry.title).font(.system(size: 10, weight: .medium)).lineLimit(1)
            }.padding(.horizontal, 3).frame(maxWidth: .infinity, alignment: .leading).frame(height: 16)
                .background(compact ? NativeCalendarColors.eventFill(color) : .clear, in: RoundedRectangle(cornerRadius: 3))
                .foregroundStyle(compact ? Color(white: 0.086) : .primary)
        }.buttonStyle(.plain).accessibilityLabel(entry.title + (entry.isAllDay ? ", All day" : ", " + entry.interval.start.formatted(date: .omitted, time: .shortened)))
            .accessibilityIdentifier("calendar-event-\(entry.eventID)")
    }
}
