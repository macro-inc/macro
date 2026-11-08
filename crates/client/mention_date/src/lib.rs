//! Portable ISO date labels shared by stored mention consumers.
#![deny(missing_docs)]

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Label for a bare ISO date or timestamp, as written: "Nov 13, 2026" or
/// "Nov 13, 2026, 3:00 PM". `None` when it is not a real date and time.
/// `parseDateMentionBody` in `packages/lexical-core` labels them the same way.
pub fn bare_date_label(body: &str) -> Option<String> {
    let (_, year, month, day, hour, minute) = lazy_regex::regex_captures!(
        r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$",
        body
    )?;
    let year: u32 = year.parse().ok()?;
    let month: usize = month.parse().ok()?;
    let day: u32 = day.parse().ok()?;
    let is_leap = (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400);
    let days_in_month = match month {
        2 if is_leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1..=12 => 31,
        _ => return None,
    };
    if day == 0 || day > days_in_month {
        return None;
    }
    let date = format!("{} {day}, {year}", MONTHS[month - 1]);
    if hour.is_empty() {
        return Some(date);
    }
    let hour: u32 = hour.parse().ok()?;
    if hour > 23 || minute.parse::<u32>().ok()? > 59 {
        return None;
    }
    let period = if hour < 12 { "AM" } else { "PM" };
    let hour = match hour % 12 {
        0 => 12,
        hour => hour,
    };
    Some(format!("{date}, {hour}:{minute} {period}"))
}
