//! RFC 5545 export of one calendar event, for adding it to a calendar Macro
//! does not write to.

#[cfg(test)]
mod test;

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;

use super::{
    meeting_links::{first_macro_call_url, strip_macro_call},
    models::{EventTime, EventType},
};

/// Longest content line, in octets, before RFC 5545 folding.
const MAX_LINE_OCTETS: usize = 75;

/// How a requester sees an event they export or copy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarEventExportAccess {
    /// A projection of the meeting is on one of the requester's own or
    /// linked calendars.
    OwnCopy,
    /// The requester sees the event only because it was shared with a
    /// channel they currently belong to.
    ChannelShared,
}

/// Series-level content of an event a requester can see, as exported to
/// iCalendar or copied onto one of their own calendars.
///
/// Attendees and the conference link are deliberately absent: a channel
/// share exposes the meeting, not its guest list or join link, and the export
/// has one shape however the requester sees the event. A Macro call travels
/// in the description and location instead, so the renderer strips it there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEventExport {
    /// How the requester sees the event.
    pub access: CalendarEventExportAccess,
    /// Owner of the resolved projection: the requester for their own copy,
    /// the person who shared it for a channel share.
    pub owner_id: String,
    /// Provider event type; only regular events can be copied.
    pub event_type: EventType,
    /// RFC 5545 UID shared by every projection of the meeting.
    pub ical_uid: String,
    /// Provider/iCalendar sequence number.
    pub sequence: u32,
    /// Display title.
    pub title: String,
    /// Full provider description, plain text or HTML.
    pub description: Option<String>,
    /// Location label.
    pub location: Option<String>,
    /// Series time: the first instance of a recurring event.
    pub time: EventTime,
    /// Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`).
    pub recurrence_lines: Vec<String>,
    /// Organizer email.
    pub organizer_email: Option<String>,
    /// Organizer display name.
    pub organizer_name: Option<String>,
    /// Entity update time.
    pub updated_at: DateTime<Utc>,
}

impl CalendarEventExport {
    /// The meeting content a snapshot of this event carries.
    pub fn snapshot(self) -> EventSnapshot {
        EventSnapshot {
            ical_uid: self.ical_uid,
            sequence: self.sequence,
            title: self.title,
            description: self.description,
            location: self.location,
            time: self.time,
            recurrence_lines: self.recurrence_lines,
            organizer_email: self.organizer_email,
            organizer_name: self.organizer_name,
        }
    }
}

/// What a snapshot imported onto a requester's calendar carries: the
/// meeting's identity, revision and series content, from a channel share or
/// from an event file someone sent them. Guests and the conference link are
/// left out, so importing it invites no one and opens no way into the call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventSnapshot {
    /// RFC 5545 UID shared by every projection of the meeting.
    pub ical_uid: String,
    /// Provider/iCalendar sequence number.
    pub sequence: u32,
    /// Display title.
    pub title: String,
    /// Description, plain text or HTML.
    pub description: Option<String>,
    /// Location label.
    pub location: Option<String>,
    /// Series time: the first instance of a recurring event.
    pub time: EventTime,
    /// Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`).
    pub recurrence_lines: Vec<String>,
    /// Organizer email.
    pub organizer_email: Option<String>,
    /// Organizer display name.
    pub organizer_name: Option<String>,
}

impl EventSnapshot {
    /// The snapshot without the Macro call join link
    /// [`attach_macro_call`](super::meeting_links::attach_macro_call) wrote
    /// into its description and location: it shares the meeting, not a way
    /// into its call. A description holding the link is reduced to plain
    /// text to take its join line out; one without it is left as written.
    pub fn without_macro_call(self) -> Self {
        let Some(url) = first_macro_call_url(self.location.as_deref(), self.description.as_deref())
        else {
            return self;
        };
        let description = self
            .description
            .as_deref()
            .and_then(plain_text)
            .unwrap_or_default();
        let (description, location) = strip_macro_call(
            &description,
            self.location.as_deref().unwrap_or_default(),
            &url,
        );
        Self {
            description: (!description.is_empty()).then_some(description),
            location: (!location.is_empty()).then_some(location),
            ..self
        }
    }
}

/// One event rendered as an iCalendar document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEventIcs {
    /// Display title, for naming the file.
    pub title: String,
    /// The `VCALENDAR` document.
    pub document: String,
}

/// Render an event as a single-event `VCALENDAR` document.
///
/// The UID is the meeting's own, so a client that already holds the meeting
/// updates it rather than duplicating it. A one-off timed event is written in
/// UTC. A recurring one keeps its original IANA zone when it is known, so the
/// series holds its wall-clock time across daylight-saving changes; that
/// `TZID` carries no `VTIMEZONE` block, which Google, Apple and Outlook
/// resolve by name but strict importers may reject.
pub fn render_event_ics(event: &CalendarEventExport) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Macro//Calendar//EN".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
        "BEGIN:VEVENT".to_string(),
        format!("UID:{}", escape_text(&event.ical_uid)),
        format!("DTSTAMP:{}", utc_stamp(event.updated_at)),
        format!("SEQUENCE:{}", event.sequence),
    ];
    let recurrence_lines: Vec<&str> = event
        .recurrence_lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect();
    lines.extend(time_lines(&event.time, !recurrence_lines.is_empty()));
    lines.extend(recurrence_lines.into_iter().map(str::to_string));
    lines.push(format!("SUMMARY:{}", escape_text(&event.title)));
    let description = event
        .description
        .as_deref()
        .and_then(plain_text)
        .unwrap_or_default();
    let location = event.location.clone().unwrap_or_default();
    let (description, location) =
        match first_macro_call_url(event.location.as_deref(), event.description.as_deref()) {
            Some(url) => strip_macro_call(&description, &location, &url),
            None => (description, location),
        };
    if !description.is_empty() {
        lines.push(format!("DESCRIPTION:{}", escape_text(&description)));
    }
    if !location.is_empty() {
        lines.push(format!("LOCATION:{}", escape_text(&location)));
    }
    if let Some(email) = event.organizer_email.as_deref() {
        let name = event
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

fn time_lines(time: &EventTime, is_recurring: bool) -> [String; 2] {
    match time {
        EventTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        } => match time_zone
            .as_deref()
            .filter(|_| is_recurring)
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
    for character in value.chars() {
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
/// `None` when the markup cannot be converted.
fn plain_text(description: &str) -> Option<String> {
    if description.contains('<') {
        email_utils::body_parsed::html_to_plaintext(description)
    } else {
        Some(description.trim().to_string())
    }
}

/// Append one content line, folded at 75 octets without splitting a UTF-8
/// character, terminated by CRLF. Control characters other than tab are
/// dropped: recurrence and organizer values are written unescaped, and a
/// stored line break would otherwise start a forged property.
fn fold_line(line: &str, document: &mut String) {
    let mut octets = 0;
    for character in line
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
    {
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
