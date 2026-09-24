//! RFC 5545 export of one calendar event, for adding it to a calendar Macro
//! does not write to.

#[cfg(test)]
mod test;

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;

use super::models::{CalendarEventCopySource, EventTime};

/// Longest content line, in octets, before RFC 5545 folding.
const MAX_LINE_OCTETS: usize = 75;

/// Render an event as a single-event `VCALENDAR` document.
///
/// The UID is the meeting's own, so a client that already holds the meeting
/// updates it rather than duplicating it. Timed events are written in their
/// original IANA zone when it is known, so a recurrence keeps its wall-clock
/// time across daylight-saving changes; clients resolve the `TZID` without a
/// `VTIMEZONE` block.
pub fn render_event_ics(source: &CalendarEventCopySource) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Macro//Calendar//EN".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
        "BEGIN:VEVENT".to_string(),
        format!("UID:{}", escape_text(&source.ical_uid)),
        format!("DTSTAMP:{}", utc_stamp(source.updated_at)),
        format!("SEQUENCE:{}", source.sequence),
    ];
    lines.extend(time_lines(&source.time));
    lines.extend(
        source
            .recurrence_lines
            .iter()
            .filter(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string()),
    );
    lines.push(format!("SUMMARY:{}", escape_text(&source.title)));
    if let Some(description) = source
        .description
        .as_deref()
        .map(plain_text)
        .filter(|text| !text.is_empty())
    {
        lines.push(format!("DESCRIPTION:{}", escape_text(&description)));
    }
    if let Some(location) = source.location.as_deref().filter(|value| !value.is_empty()) {
        lines.push(format!("LOCATION:{}", escape_text(location)));
    }
    if let Some(email) = source.organizer_email.as_deref() {
        let name = source
            .organizer_name
            .as_deref()
            .filter(|name| !name.is_empty())
            .map(|name| format!(";CN={}", quote_param(name)))
            .unwrap_or_default();
        lines.push(format!("ORGANIZER{name}:mailto:{email}"));
    }
    lines.push("END:VEVENT".to_string());
    lines.push("END:VCALENDAR".to_string());

    let mut document = String::new();
    for line in lines {
        fold_line(&line, &mut document);
    }
    document
}

fn time_lines(time: &EventTime) -> [String; 2] {
    match time {
        EventTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        } => match time_zone
            .as_deref()
            .and_then(|zone| zone.parse::<Tz>().ok())
        {
            Some(zone) => [
                format!(
                    "DTSTART;TZID={}:{}",
                    zone.name(),
                    starts_at.with_timezone(&zone).format("%Y%m%dT%H%M%S")
                ),
                format!(
                    "DTEND;TZID={}:{}",
                    zone.name(),
                    ends_at.with_timezone(&zone).format("%Y%m%dT%H%M%S")
                ),
            ],
            None => [
                format!("DTSTART:{}", utc_stamp(*starts_at)),
                format!("DTEND:{}", utc_stamp(*ends_at)),
            ],
        },
        EventTime::AllDay {
            start_date,
            end_date,
        } => [
            format!("DTSTART;VALUE=DATE:{}", ics_date(*start_date)),
            format!("DTEND;VALUE=DATE:{}", ics_date(*end_date)),
        ],
    }
}

fn utc_stamp(instant: DateTime<Utc>) -> String {
    instant.format("%Y%m%dT%H%M%SZ").to_string()
}

fn ics_date(date: NaiveDate) -> String {
    date.format("%Y%m%d").to_string()
}

/// Escape a TEXT value (RFC 5545 §3.3.11).
fn escape_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.replace("\r\n", "\n").chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            ';' => escaped.push_str("\\;"),
            ',' => escaped.push_str("\\,"),
            '\n' => escaped.push_str("\\n"),
            '\r' => {}
            other => escaped.push(other),
        }
    }
    escaped
}

/// Quote a parameter value, which may not contain a double quote.
fn quote_param(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "'"))
}

/// Provider descriptions are often HTML; iCalendar `DESCRIPTION` is plain
/// text, so markup is reduced to its text, one line per non-empty block.
fn plain_text(description: &str) -> String {
    if !description.contains('<') {
        return description.trim().to_string();
    }
    let mut text = String::with_capacity(description.len());
    let mut rest = description;
    while let Some(open) = rest.find('<') {
        text.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('>') else {
            text.push_str(&rest[open..]);
            rest = "";
            break;
        };
        let tag = rest[open + 1..open + close]
            .trim_start_matches('/')
            .split(|character: char| character.is_whitespace() || character == '/')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(tag.as_str(), "br" | "p" | "div" | "li" | "ul" | "ol") {
            text.push('\n');
        }
        rest = &rest[open + close + 1..];
    }
    text.push_str(rest);
    let decoded = text
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Append one content line, folded at 75 octets without splitting a UTF-8
/// character, terminated by CRLF.
fn fold_line(line: &str, document: &mut String) {
    let mut octets = 0;
    for character in line.chars() {
        let width = character.len_utf8();
        if octets + width > MAX_LINE_OCTETS {
            document.push_str("\r\n ");
            // The continuation's leading space counts toward its length.
            octets = 1;
        }
        document.push(character);
        octets += width;
    }
    document.push_str("\r\n");
}
