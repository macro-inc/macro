//! One mailbox's calendars: the calendars themselves, their events and
//! series, and the change sequence `calendarView/delta` reads.
//!
//! An event is stored as the properties Graph lets a client write, in
//! Graph's own JSON. A series is one stored event: its occurrences are
//! computed from its recurrence, an occurrence someone changed is an
//! [`Exception`] holding only what differs, and a deleted one is a date in
//! `cancelled`.

mod delta;
mod guests;
mod render;
mod time;
mod write;

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Days, NaiveDate, Utc};
use chrono_tz::Tz;
use serde_json::{Map, Value};

use crate::mailbox::Address;
use crate::seed::SeedCalendar;

pub(crate) use delta::{CalendarCursor, CalendarEntry};
pub(crate) use guests::{answer_organizer, delete_event, share_with_guests};
pub(crate) use render::{Listing, calendar_resource, event_resource, occurrence_resource};
pub(crate) use time::LocalTime;
pub(crate) use write::{Answer, Writer};

use time::Recurrence;

const DEFAULT_CALENDAR_NAME: &str = "Calendar";
const ID_PREFIX: &str = "AAMkAD";
/// `PidLidAppointmentSequence`, which Graph answers as an extended property.
pub(crate) const SEQUENCE_PROPERTY: &str =
    "Integer {00062002-0000-0000-C000-000000000046} Id 0x8201";

/// A calendar of the mailbox.
#[derive(Clone, Debug)]
pub(crate) struct Calendar {
    pub(crate) id: String,
    pub(crate) name: String,
    /// Graph's `color`, such as `auto` or `lightBlue`.
    pub(crate) color: String,
    pub(crate) hex_color: String,
    pub(crate) can_edit: bool,
    pub(crate) is_default: bool,
    pub(crate) online_meeting_providers: Vec<String>,
}

/// The mailbox owner's answer to a meeting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Response {
    /// `none`, `organizer`, `accepted`, `tentativelyAccepted`, `declined`
    /// or `notResponded`.
    pub(crate) response: String,
    pub(crate) time: Option<DateTime<Utc>>,
}

impl Response {
    fn new(response: &str) -> Self {
        Self {
            response: response.to_string(),
            time: None,
        }
    }
}

/// An occurrence of a series that someone changed: what differs from the
/// series, by property.
#[derive(Clone, Debug, Default)]
pub(crate) struct Exception {
    pub(crate) overrides: Map<String, Value>,
    pub(crate) properties: BTreeMap<String, String>,
    pub(crate) version: u64,
    pub(crate) modified: Option<DateTime<Utc>>,
    /// The owner's answer to this occurrence alone.
    pub(crate) response: Option<Response>,
}

/// A single event or a whole series.
#[derive(Clone, Debug)]
pub(crate) struct Event {
    pub(crate) id: String,
    pub(crate) calendar_id: String,
    pub(crate) ical_uid: String,
    /// Bumped on every change; the etag and change key are made from it.
    pub(crate) version: u64,
    /// The mailbox calendar sequence number of its creation and last change.
    pub(crate) created_seq: u64,
    pub(crate) changed_seq: u64,
    /// The iCalendar sequence: how many times its time or recurrence changed.
    pub(crate) sequence: u32,
    pub(crate) created: DateTime<Utc>,
    pub(crate) modified: DateTime<Utc>,
    /// The properties Graph lets a client write, as Graph spells them.
    pub(crate) fields: Map<String, Value>,
    /// Extended properties a client wrote, by id.
    pub(crate) properties: BTreeMap<String, String>,
    pub(crate) organizer: Address,
    pub(crate) response: Response,
    /// Changed occurrences, by the date the series puts them on.
    pub(crate) exceptions: BTreeMap<NaiveDate, Exception>,
    /// Deleted occurrences, with the sequence number of the deletion.
    pub(crate) cancelled: BTreeMap<NaiveDate, u64>,
    /// Properties a seed answers verbatim in place of the computed ones:
    /// what a real mailbox holds that the emulator would never produce.
    pub(crate) raw: Map<String, Value>,
}

/// One occurrence of a series, with the exception that changed it if any.
#[derive(Clone, Debug)]
pub(crate) struct Occurrence<'a> {
    pub(crate) master: &'a Event,
    /// The date the series puts it on, in the series' zone.
    pub(crate) date: NaiveDate,
    /// When the series puts it.
    pub(crate) original_start: DateTime<Utc>,
    pub(crate) start: DateTime<Utc>,
    pub(crate) end: DateTime<Utc>,
    pub(crate) exception: Option<&'a Exception>,
}

impl Occurrence<'_> {
    pub(crate) fn id(&self) -> String {
        occurrence_id(&self.master.id, self.date)
    }
}

/// The id of a series' occurrence: the series' id and the occurrence's
/// date, in the alphabet of Graph's ids. It stays when the occurrence
/// becomes an exception.
pub(crate) fn occurrence_id(master: &str, date: NaiveDate) -> String {
    let plain = decode_id(master).unwrap_or_else(|| master.to_string());
    encode_id(&format!("{plain}/{date}"))
}

fn encode_id(plain: &str) -> String {
    format!("{ID_PREFIX}{}", URL_SAFE_NO_PAD.encode(plain))
}

fn decode_id(id: &str) -> Option<String> {
    let bytes = URL_SAFE_NO_PAD.decode(id.strip_prefix(ID_PREFIX)?).ok()?;
    String::from_utf8(bytes).ok()
}

/// The series and date an occurrence id names.
fn occurrence_ref(id: &str) -> Option<(String, NaiveDate)> {
    let plain = decode_id(id)?;
    let (master, date) = plain.rsplit_once('/')?;
    Some((encode_id(master), date.parse().ok()?))
}

/// What an event id names.
pub(crate) enum Found<'a> {
    Event(&'a Event),
    Occurrence(Occurrence<'a>),
}

impl Event {
    pub(crate) fn is_series(&self) -> bool {
        self.fields.get("recurrence").is_some_and(Value::is_object)
    }

    fn time(&self, key: &str) -> Option<LocalTime> {
        LocalTime::parse(self.fields.get(key)?)
    }

    pub(crate) fn start(&self) -> Option<LocalTime> {
        self.time("start")
    }

    pub(crate) fn end(&self) -> Option<LocalTime> {
        self.time("end")
    }

    /// The zone the series' dates are in.
    fn series_zone(&self) -> Option<Tz> {
        let named = self
            .fields
            .get("recurrence")
            .and_then(|recurrence| recurrence["range"]["recurrenceTimeZone"].as_str())
            .and_then(time::zone);
        named.or_else(|| self.start().map(|start| start.zone))
    }

    /// Whether the event, as a single event, overlaps a window.
    pub(crate) fn overlaps(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> bool {
        match (self.start(), self.end()) {
            (Some(start), Some(end)) => start.instant() < to && end.instant() > from,
            _ => false,
        }
    }

    /// The occurrence the series puts on a date, deleted or not.
    fn occurrence_on(&self, date: NaiveDate) -> Option<Occurrence<'_>> {
        let (start, end) = (self.start()?, self.end()?);
        let zone = self.series_zone()?;
        let length = end.instant() - start.instant();
        // The series' dates are in its own zone; the time of day is the
        // first occurrence's, read in that zone.
        let time_of_day = start.instant().with_timezone(&zone).time();
        let original_start = time::instant(date.and_time(time_of_day), zone);
        let exception = self.exceptions.get(&date);
        let moved = |key: &str| {
            exception
                .and_then(|exception| exception.overrides.get(key))
                .and_then(LocalTime::parse)
                .map(|at| at.instant())
        };
        Some(Occurrence {
            master: self,
            date,
            original_start,
            start: moved("start").unwrap_or(original_start),
            end: moved("end").unwrap_or(original_start + length),
            exception,
        })
    }

    /// The dates the series falls on up to `until`, deleted ones included.
    fn series_dates(&self, until: NaiveDate) -> Vec<NaiveDate> {
        self.fields
            .get("recurrence")
            .and_then(|recurrence| Recurrence::parse(recurrence).ok())
            .map(|recurrence| recurrence.dates(until))
            .unwrap_or_default()
    }

    /// The occurrences of the series that overlap a window, by where each
    /// is now: an exception moved out of the window is left out, and one
    /// moved into it is included.
    pub(crate) fn occurrences(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Vec<Occurrence<'_>> {
        // A day's margin covers every zone's offset from UTC.
        let window_end = to
            .date_naive()
            .checked_add_days(Days::new(1))
            .unwrap_or(NaiveDate::MAX);
        let last_exception = self.exceptions.keys().next_back().copied();
        let until = last_exception.map_or(window_end, |date| date.max(window_end));
        self.series_dates(until)
            .into_iter()
            .filter(|date| !self.cancelled.contains_key(date))
            .filter_map(|date| self.occurrence_on(date))
            .filter(|occurrence| occurrence.start < to && occurrence.end > from)
            .collect()
    }

    /// The occurrence on a date, when the series has one there that is not
    /// deleted.
    pub(crate) fn occurrence(&self, date: NaiveDate) -> Option<Occurrence<'_>> {
        if self.cancelled.contains_key(&date) || !self.series_dates(date).contains(&date) {
            return None;
        }
        self.occurrence_on(date)
    }

    /// The value of an extended property, written or computed.
    pub(crate) fn property(&self, id: &str) -> Option<String> {
        if id.eq_ignore_ascii_case(SEQUENCE_PROPERTY) {
            return Some(self.sequence.to_string());
        }
        find_property(&self.properties, id)
    }
}

pub(crate) fn find_property(properties: &BTreeMap<String, String>, id: &str) -> Option<String> {
    properties
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(id))
        .map(|(_, value)| value.clone())
}

pub(crate) fn change_key(version: u64) -> String {
    format!(
        "DwAAABYAAAA{}",
        URL_SAFE_NO_PAD.encode(format!("{version:012}"))
    )
}

/// An event that was deleted, kept for the delta rounds that must report it.
struct Removed {
    seq: u64,
    event: Event,
}

/// Everything calendar a mailbox holds.
pub(crate) struct Calendars {
    pub(crate) owner: Address,
    /// `mailboxSettings.timeZone`: a Windows or IANA name, or one neither
    /// table knows.
    pub(crate) time_zone: String,
    pub(crate) calendars: Vec<Calendar>,
    pub(crate) events: BTreeMap<String, Event>,
    removed: Vec<Removed>,
    /// The sequence number of the last change.
    seq: u64,
    /// Bumped when the sync state is dropped, which expires every delta token.
    epoch: u64,
    next_id: u64,
}

impl Calendars {
    pub(crate) fn new(owner: Address, time_zone: String) -> Self {
        let mut calendars = Self {
            owner,
            time_zone,
            calendars: Vec::new(),
            events: BTreeMap::new(),
            removed: Vec::new(),
            seq: 0,
            epoch: 0,
            next_id: 0,
        };
        calendars.seed_calendar(&SeedCalendar {
            name: DEFAULT_CALENDAR_NAME.to_string(),
            default: true,
            ..SeedCalendar::default()
        });
        calendars
    }

    fn new_id(&mut self, kind: &str) -> String {
        self.next_id += 1;
        encode_id(&format!(
            "{}/{kind}/{:06}",
            self.owner.address, self.next_id
        ))
    }

    fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    /// Adds a seeded calendar, or describes the default one. Answers its id.
    pub(crate) fn seed_calendar(&mut self, seed: &SeedCalendar) -> String {
        let id = match self.default_calendar().filter(|_| seed.default) {
            Some(default) => default.id.clone(),
            None => self.new_id("calendar"),
        };
        let calendar = Calendar {
            id: id.clone(),
            name: seed.name.clone(),
            color: seed.color.clone().unwrap_or_else(|| "auto".to_string()),
            hex_color: seed.hex_color.clone().unwrap_or_default(),
            can_edit: !seed.read_only,
            is_default: seed.default,
            online_meeting_providers: seed
                .online_meeting_providers
                .clone()
                .unwrap_or_else(|| vec!["teamsForBusiness".to_string()]),
        };
        self.calendars.retain(|known| known.id != id);
        self.calendars.push(calendar);
        id
    }

    pub(crate) fn default_calendar(&self) -> Option<&Calendar> {
        self.calendars.iter().find(|calendar| calendar.is_default)
    }

    /// A calendar by id, by `default`, or (for seeds and the control API)
    /// by name.
    pub(crate) fn calendar(&self, key: &str) -> Option<&Calendar> {
        let by_id = self.calendars.iter().find(|calendar| calendar.id == key);
        let by_name = || {
            self.calendars
                .iter()
                .find(|calendar| calendar.name.eq_ignore_ascii_case(key))
        };
        match key {
            "default" => self.default_calendar(),
            _ => by_id.or_else(by_name),
        }
    }

    /// What an id names: an event, or an occurrence of a series.
    pub(crate) fn find(&self, id: &str) -> Option<Found<'_>> {
        if let Some(event) = self.events.get(id) {
            return Some(Found::Event(event));
        }
        let (master, date) = occurrence_ref(id)?;
        let occurrence = self.events.get(&master)?.occurrence(date)?;
        Some(Found::Occurrence(occurrence))
    }

    /// The stored event an id belongs to, and the occurrence date it names.
    pub(crate) fn locate(&self, id: &str) -> Option<(String, Option<NaiveDate>)> {
        match self.find(id)? {
            Found::Event(event) => Some((event.id.clone(), None)),
            Found::Occurrence(occurrence) => {
                Some((occurrence.master.id.clone(), Some(occurrence.date)))
            }
        }
    }

    /// The owner's copy of a meeting, by its iCalendar UID.
    pub(crate) fn by_uid(&self, uid: &str) -> Option<&Event> {
        self.events.values().find(|event| event.ical_uid == uid)
    }

    /// Marks an event as changed, after mutating it.
    pub(crate) fn touch(&mut self, id: &str, now: DateTime<Utc>) {
        let seq = self.next_seq();
        if let Some(event) = self.events.get_mut(id) {
            event.version += 1;
            event.changed_seq = seq;
            event.modified = now;
        }
    }

    /// Deletes an event for good. Answers what was deleted.
    pub(crate) fn remove(&mut self, id: &str) -> Option<Event> {
        let event = self.events.remove(id)?;
        let seq = self.next_seq();
        self.removed.push(Removed {
            seq,
            event: event.clone(),
        });
        Some(event)
    }

    /// Deletes one occurrence of a series.
    pub(crate) fn cancel_occurrence(&mut self, master: &str, date: NaiveDate, now: DateTime<Utc>) {
        let seq = self.seq + 1;
        if let Some(event) = self.events.get_mut(master) {
            event.exceptions.remove(&date);
            event.cancelled.insert(date, seq);
        }
        self.touch(master, now);
    }

    /// Drops the sync state: every delta token now answers 410.
    pub(crate) fn expire_delta_tokens(&mut self) {
        self.epoch += 1;
    }
}
