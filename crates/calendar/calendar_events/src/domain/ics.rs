//! RFC 5545 export of one calendar event, for adding it to a calendar Macro
//! does not write to, or for a guest forwarding their copy by email.

#[cfg(test)]
mod test;

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;

use super::{
    meeting_links::{first_macro_call_url, strip_macro_call},
    models::{ConferenceProvider, EventTime, EventType},
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
/// in the description and location instead, so the renderer strips it there
/// unless a guest is forwarding their own copy ([`IcsPurpose`]), which reads
/// the conference link from that copy ([`ForwardedCopy`]).
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
/// from an event file someone sent them. Guests are left out, so importing it
/// invites no one. A channel share also leaves out the join link
/// ([`Self::without_macro_call`]); a forwarded file keeps whatever link it
/// carries, since its sender meant to invite the recipient.
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
    /// The snapshot without its Macro call ([`content_without_macro_call`]).
    pub fn without_macro_call(self) -> Self {
        let (description, location) = content_without_macro_call(self.description, self.location);
        Self {
            description,
            location,
            ..self
        }
    }
}

/// A channel share's view of an event's description and location, without the
/// Macro call join link
/// [`attach_macro_call`](super::meeting_links::attach_macro_call) wrote into
/// them: it shares the meeting, not a way into its call. A description holding
/// the link is reduced to plain text to take its join line out; one without it
/// is left as written.
pub fn content_without_macro_call(
    description: Option<String>,
    location: Option<String>,
) -> (Option<String>, Option<String>) {
    let Some(url) = first_macro_call_url(location.as_deref(), description.as_deref()) else {
        return (description, location);
    };
    let holds_link = first_macro_call_url(None, description.as_deref()).is_some();
    let text = description
        .as_deref()
        .and_then(plain_text)
        .unwrap_or_default();
    let (text, location) = strip_macro_call(&text, location.as_deref().unwrap_or_default(), &url);
    (
        if holds_link {
            (!text.is_empty()).then_some(text)
        } else {
            description
        },
        (!location.is_empty()).then_some(location),
    )
}

/// One event rendered as an iCalendar document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEventIcs {
    /// Display title, for naming the file.
    pub title: String,
    /// The `VCALENDAR` document.
    pub document: String,
}

/// Someone an event file names: an attendee of an invitation, or the
/// organizer it is answered to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IcsParticipant {
    /// Email address.
    pub email: String,
    /// Display name, when known.
    pub name: Option<String>,
}

/// A copy's provider conference link, which the meeting's content does not
/// carry: Google Meet, Microsoft Teams, or a third party's such as Zoom.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JoinLink {
    /// The URL that joins the call.
    pub url: String,
    /// Which system backs it, when known.
    pub provider: Option<ConferenceProvider>,
}

/// What an event file is rendered for, which decides what it carries beyond
/// the meeting's content. One renderer serves every use, so they differ only
/// where this says so.
#[derive(Clone, Copy, Debug)]
pub enum IcsPurpose<'a> {
    /// Sharing the meeting without inviting anyone: the .ics download. It
    /// names no attendees and leaves out the join link, a Macro call's
    /// included, since it shares the meeting, not a way into its call.
    Share,
    /// A guest forwarding their copy by email, which deliberately invites the
    /// people it goes to: the join link stays, as it does in Google's own
    /// forward.
    Forward {
        /// The copy's provider conference.
        join_link: Option<&'a JoinLink>,
        /// The people it goes to, as the attendees of a `METHOD:REQUEST`
        /// invitation they answer to the organizer. `None` publishes the
        /// event (`METHOD:PUBLISH`) naming nobody, which a recipient can only
        /// add to their calendar.
        invitees: Option<&'a [IcsParticipant]>,
    },
}

/// How a forward reaches its recipients, decided from the forwarder's copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarEventForwardKind {
    /// The shared-event file (`METHOD:PUBLISH`, no attendees): recipients
    /// can add the event to their calendar, and nothing reaches the
    /// organizer. Used whenever the organizer could have a say in who is
    /// invited, and whenever that is unclear.
    EventFile,
    /// A real invitation (`METHOD:REQUEST`) from an organizer outside
    /// Google, as Google's own Add guests sends on such a copy: it names the
    /// recipients as attendees, they answer it to the organizer, and the
    /// email goes to the organizer too.
    Invitation {
        /// Who the answers go to.
        organizer: IcsParticipant,
    },
}

impl CalendarEventForwardKind {
    /// Span and log form.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EventFile => "event_file",
            Self::Invitation { .. } => "invitation",
        }
    }
}

/// What forwarding one of the requester's events by email sends, and from
/// where: the event's document, rendered for the kind of forward its copy
/// allows, and the inbox holding the requester's own copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEventForward {
    /// The event as an iCalendar document, with its title.
    pub ics: CalendarEventIcs,
    /// Address of the requester's own inbox that holds the requested copy.
    pub inbox: String,
    /// Whether the document is an invitation or the shared-event file.
    pub kind: CalendarEventForwardKind,
}

/// What a forwarded copy's stored source shows about where its invitation
/// came from, and the conference link it carries.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ForwardedCopy {
    /// Whether the copy is Google's private copy of an invitation, in every
    /// Google calendar holding it: what Google keeps of an invitation from
    /// another calendar system, such as Exchange, and also of an imported
    /// event file. False for an Outlook copy, and for a Google source synced
    /// before Macro kept Google's whole payload.
    pub google_private_copy: bool,
    /// Whether the copy, or any calendar's projection of it, is a snapshot
    /// Macro imported.
    pub is_snapshot: bool,
    /// The copy's provider conference.
    pub join_link: Option<JoinLink>,
}

impl ForwardedCopy {
    /// The organizer an invitation forwarded from this copy is answered to,
    /// when the copy shows the organizer is outside Google; `None` keeps the
    /// shared-event file.
    ///
    /// The evidence is Google's private copy, which Google keeps of every
    /// invitation from another calendar system and reports as letting no
    /// guest invite, whatever the organizer chose. A snapshot is a private
    /// copy Macro imported, and so is any event file a user imported into
    /// Google; one whose UID Google minted (`…@google.com`) belongs to a
    /// Google organizer, whose own choice about guests stands. Anything
    /// short of that evidence, an organizer Macro cannot name included, falls
    /// back to the shared-event file: a wrong guess would notify an organizer
    /// who turned inviting off.
    pub fn outside_organizer(&self, event: &CalendarEventExport) -> Option<IcsParticipant> {
        if !self.google_private_copy || self.is_snapshot || is_google_uid(&event.ical_uid) {
            return None;
        }
        let email = event
            .organizer_email
            .as_deref()
            .map(str::trim)
            .filter(|email| email.contains('@'))?;
        Some(IcsParticipant {
            email: email.to_string(),
            name: event
                .organizer_name
                .clone()
                .filter(|name| !name.trim().is_empty()),
        })
    }
}

/// Whether Google minted `uid`, which it does for every event created in
/// Google Calendar, so the meeting has a Google organizer.
fn is_google_uid(uid: &str) -> bool {
    uid.trim().to_ascii_lowercase().ends_with(GOOGLE_UID_SUFFIX)
}

/// The domain Google gives the UIDs of events created in Google Calendar.
const GOOGLE_UID_SUFFIX: &str = "@google.com";

/// Render an event as a single-event `VCALENDAR` document for `purpose`.
///
/// The UID is the meeting's own, so a client that already holds the meeting
/// updates it rather than duplicating it, and an answer to an invitation
/// reaches the organizer's meeting. A one-off timed event is written in
/// UTC. A recurring one keeps its original IANA zone when it is known, so the
/// series holds its wall-clock time across daylight-saving changes; that
/// `TZID` carries no `VTIMEZONE` block, which Google, Apple and Outlook
/// resolve by name but strict importers may reject.
pub fn render_event_ics(event: &CalendarEventExport, purpose: IcsPurpose<'_>) -> String {
    let (join_link, invitees) = match purpose {
        IcsPurpose::Share => (None, None),
        IcsPurpose::Forward {
            join_link,
            invitees,
        } => (join_link, invitees),
    };
    let method = if invitees.is_some() {
        "METHOD:REQUEST"
    } else {
        "METHOD:PUBLISH"
    };
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Macro//Calendar//EN".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        method.to_string(),
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
    let macro_call = first_macro_call_url(event.location.as_deref(), event.description.as_deref());
    let (description, location) = match (purpose, macro_call) {
        (IcsPurpose::Share, Some(url)) => strip_macro_call(&description, &location, &url),
        (IcsPurpose::Share, None) => (description, location),
        // The plain text shows the generated join line's link in brackets,
        // which some clients would make part of the link.
        (IcsPurpose::Forward { .. }, Some(url)) => (
            with_join_line(
                description.replace(&format!("[{url}]"), &url),
                &location,
                join_link,
            ),
            location,
        ),
        (IcsPurpose::Forward { .. }, None) => {
            (with_join_line(description, &location, join_link), location)
        }
    };
    if !description.is_empty() {
        lines.push(format!("DESCRIPTION:{}", escape_text(&description)));
    }
    if !location.is_empty() {
        lines.push(format!("LOCATION:{}", escape_text(&location)));
    }
    if let Some(link) = join_link.filter(|link| is_web_url(&link.url)) {
        if link.provider == Some(ConferenceProvider::GoogleMeet) {
            lines.push(format!("X-GOOGLE-CONFERENCE:{}", link.url));
        }
        lines.push(format!("CONFERENCE;VALUE=URI;FEATURE=VIDEO:{}", link.url));
    }
    if let Some(email) = event.organizer_email.as_deref() {
        lines.push(format!(
            "ORGANIZER{}:mailto:{email}",
            common_name(event.organizer_name.as_deref())
        ));
    }
    for invitee in invitees.unwrap_or_default() {
        lines.push(format!(
            "ATTENDEE{};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{}",
            common_name(invitee.name.as_deref()),
            invitee.email
        ));
    }
    lines.push("END:VEVENT".to_string());
    lines.push("END:VCALENDAR".to_string());

    let mut document = String::new();
    for line in lines {
        fold_line(&line, &mut document);
    }
    document
}

/// A participant's `CN` parameter, or nothing without a name.
fn common_name(name: Option<&str>) -> String {
    name.map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| format!(";CN={}", quote_param(name)))
        .unwrap_or_default()
}

/// The description with a line naming the copy's conference link, as
/// Google's own invitations carry it, so every client shows it and a copy
/// added from the file keeps it. A link the description or location already
/// shows, as a Teams invitation's body does, is not repeated.
fn with_join_line(description: String, location: &str, join_link: Option<&JoinLink>) -> String {
    let Some(link) = join_link.filter(|link| is_web_url(&link.url)) else {
        return description;
    };
    if description.contains(&link.url) || location.contains(&link.url) {
        return description;
    }
    let label = match link.provider {
        Some(ConferenceProvider::GoogleMeet) => "Join with Google Meet",
        Some(ConferenceProvider::MicrosoftTeams) => "Join the Microsoft Teams meeting",
        Some(ConferenceProvider::Other) | None => "Join the meeting",
    };
    let line = format!("{label}: {}", link.url);
    if description.is_empty() {
        line
    } else {
        format!("{description}\n\n{line}")
    }
}

/// Whether `url` is a web link, the only kind a calendar can open as a call.
fn is_web_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
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
