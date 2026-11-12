//! Portable ISO date labels shared by stored mention consumers.
#![deny(missing_docs)]

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Label for a bare ISO date or timestamp, as written: "Nov 13, 2026" or
/// "Nov 13, 2026, 3:00 PM". `None` when it is not a real date and time.
/// `parseDateMentionBody` in `packages/lexical-core` labels them the same way.
pub fn bare_date_label(body: &str) -> Option<String> {
    let (year, month, day, hour, minute) = bare_date_fields(body)?;
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

/// The captures of `^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$`
/// with ASCII digits (JS `\d`, as in the TS twin); hour and minute are empty for a bare date.
fn bare_date_fields(body: &str) -> Option<(&str, &str, &str, &str, &str)> {
    let bytes = body.as_bytes();
    let digits = |at: usize, count: usize| {
        bytes
            .get(at..at + count)
            .is_some_and(|run| run.iter().all(u8::is_ascii_digit))
    };
    let byte = |at: usize, expected: u8| bytes.get(at) == Some(&expected);
    if !(digits(0, 4) && byte(4, b'-') && digits(5, 2) && byte(7, b'-') && digits(8, 2)) {
        return None;
    }
    let date = (&body[0..4], &body[5..7], &body[8..10]);
    if bytes.len() == 10 {
        return Some((date.0, date.1, date.2, "", ""));
    }
    if !(byte(10, b'T') && digits(11, 2) && byte(13, b':') && digits(14, 2)) {
        return None;
    }
    let mut at = 16;
    if byte(at, b':') && digits(at + 1, 2) {
        at += 3;
        if byte(at, b'.') && digits(at + 1, 1) {
            at += 1;
            while digits(at, 1) {
                at += 1;
            }
        }
    }
    let zone = match bytes.get(at) {
        Some(b'Z') => at + 1,
        Some(b'+' | b'-') if digits(at + 1, 2) && byte(at + 3, b':') && digits(at + 4, 2) => at + 6,
        _ => return None,
    };
    (zone == bytes.len()).then(|| (date.0, date.1, date.2, &body[11..13], &body[14..16]))
}

#[cfg(test)]
mod test;
