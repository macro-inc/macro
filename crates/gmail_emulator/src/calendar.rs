//! Google Calendar: a user's calendars, their events, sync tokens and push
//! channels, and what `calendarList.list`, `events.list`, `events.get` and
//! `events.instances` answer.
//!
//! An event is stored as the JSON object Google would answer, without the
//! fields that depend on who is asking (`self`) or on the zone asked for.

mod channel;
mod time;
mod write;

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, SecondsFormat, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub use channel::ResourceState;
pub(crate) use channel::{Channel, ChannelNotification};
pub(crate) use time::{Point, Span, Window};
pub(crate) use write::{Actor, WriteOptions};

use crate::error::ApiError;
use crate::seed::SeedCalendar;

/// The scopes that allow calendar requests all start with this.
pub(crate) const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
const DEFAULT_COLOR: &str = "#9fe1e7";
const CANCELLED: &str = "cancelled";

/// An event as Google's JSON object.
pub(crate) type Fields = Map<String, Value>;

/// What a user may do with a calendar on their list.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Deserialize,
    Serialize,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum AccessRole {
    /// Sees only when the calendar is busy.
    FreeBusyReader,
    /// Reads events.
    Reader,
    /// Reads and writes events.
    Writer,
    /// Writes events and manages the calendar.
    #[default]
    Owner,
}

/// What `events.list` was asked.
#[derive(Clone, Debug, Default)]
pub(crate) struct ListQuery {
    pub(crate) window: Window,
    pub(crate) single_events: bool,
    pub(crate) show_deleted: bool,
    pub(crate) ical_uid: Option<String>,
    pub(crate) order_by_start: bool,
    pub(crate) sync_token: Option<String>,
    /// `timeZone`: the zone times are answered in.
    pub(crate) zone: Option<Tz>,
    pub(crate) offset: usize,
    pub(crate) page_size: usize,
}

/// Where a sync token continues from.
#[derive(Clone, Debug)]
struct SyncCursor {
    revision: u64,
    /// The `timeMin` of the listing that earned the token, which Google
    /// keeps applying to the changes it reports.
    from: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub(crate) struct StoredEvent {
    pub(crate) fields: Fields,
    /// The calendar's revision at the event's last change.
    pub(crate) revision: u64,
    /// Put here by `events.import`: a private copy that follows no other.
    pub(crate) imported: bool,
    /// The calendar's owner deleted this copy of someone else's event.
    pub(crate) removed_by_guest: bool,
}

impl StoredEvent {
    pub(crate) fn is_cancelled(&self) -> bool {
        text(&self.fields, "status") == Some(CANCELLED)
    }

    pub(crate) fn recurring_event_id(&self) -> Option<&str> {
        text(&self.fields, "recurringEventId")
    }

    pub(crate) fn is_recurring(&self) -> bool {
        !recurrence(&self.fields).is_empty()
    }
}

/// A string field of an event.
pub(crate) fn text<'a>(fields: &'a Fields, name: &str) -> Option<&'a str> {
    fields.get(name).and_then(Value::as_str)
}

/// An event's `recurrence` lines.
pub(crate) fn recurrence(fields: &Fields) -> Vec<String> {
    fields
        .get("recurrence")
        .and_then(Value::as_array)
        .map(|lines| {
            lines
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The address of an event's organizer: the calendar it was made on.
pub(crate) fn organizer_email(fields: &Fields) -> Option<&str> {
    fields.get("organizer")?.get("email")?.as_str()
}

pub(crate) fn attendee_email(attendee: &Value) -> Option<&str> {
    attendee.get("email").and_then(Value::as_str)
}

pub(crate) fn attendees(fields: &Fields) -> &[Value] {
    fields
        .get("attendees")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

/// One of Google's three guest switches, which it omits at its default.
pub(crate) fn guest_switch(fields: &Fields, name: &str, default: bool) -> bool {
    fields.get(name).and_then(Value::as_bool).unwrap_or(default)
}

pub(crate) fn timestamp(now_ms: i64) -> String {
    DateTime::from_timestamp_millis(now_ms)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(crate) fn not_found() -> ApiError {
    ApiError::calendar(404, "notFound", "Not Found")
}

/// One calendar on a user's list, with the events it holds for them.
#[derive(Debug)]
pub(crate) struct Calendar {
    pub(crate) id: String,
    pub(crate) summary: String,
    pub(crate) description: Option<String>,
    pub(crate) zone: Tz,
    pub(crate) background_color: String,
    pub(crate) access_role: AccessRole,
    pub(crate) primary: bool,
    pub(crate) selected: bool,
    pub(crate) default_reminders: Vec<Value>,
    /// Google refuses `events.watch` on some calendars, such as holidays.
    pub(crate) push_supported: bool,
    pub(crate) events: BTreeMap<String, StoredEvent>,
    /// Bumped by every change to an event.
    pub(crate) revision: u64,
    /// The revision the channels were last notified about.
    notified_revision: u64,
    sync_tokens: HashMap<String, SyncCursor>,
    sync_tokens_issued: u64,
    pub(crate) channels: Vec<Channel>,
}

impl Calendar {
    /// A user's primary calendar, whose id is their address.
    pub(crate) fn primary(email: &str) -> Self {
        Self {
            id: email.to_string(),
            summary: email.to_string(),
            description: None,
            zone: Tz::UTC,
            background_color: DEFAULT_COLOR.to_string(),
            access_role: AccessRole::Owner,
            primary: true,
            selected: true,
            default_reminders: vec![json!({ "method": "popup", "minutes": 30 })],
            push_supported: true,
            events: BTreeMap::new(),
            revision: 0,
            notified_revision: 0,
            sync_tokens: HashMap::new(),
            sync_tokens_issued: 0,
            channels: Vec::new(),
        }
    }

    /// Another calendar on the user's list.
    pub(crate) fn secondary(id: String, seed: &SeedCalendar) -> Self {
        Self {
            summary: id.clone(),
            primary: false,
            default_reminders: Vec::new(),
            ..Self::primary(&id)
        }
        .described_by(seed)
    }

    /// Takes what a seed says about the calendar.
    pub(crate) fn described_by(mut self, seed: &SeedCalendar) -> Self {
        if let Some(summary) = &seed.summary {
            self.summary = summary.clone();
        }
        if let Some(description) = &seed.description {
            self.description = Some(description.clone());
        }
        if let Some(zone) = seed.time_zone {
            self.zone = zone;
        }
        if let Some(color) = &seed.background_color {
            self.background_color = color.clone();
        }
        if let Some(role) = seed.access_role {
            self.access_role = role;
        }
        if let Some(selected) = seed.selected {
            self.selected = selected;
        }
        if let Some(reminders) = &seed.default_reminders {
            self.default_reminders = reminders
                .iter()
                .map(|reminder| json!({ "method": reminder.method, "minutes": reminder.minutes }))
                .collect();
        }
        self.push_supported = seed.push_supported;
        self
    }

    pub(crate) fn can_write(&self) -> bool {
        self.access_role >= AccessRole::Writer
    }

    fn etag(&self) -> String {
        format!("\"{}\"", self.revision)
    }

    /// The `calendarList` entry.
    pub(crate) fn list_entry(&self) -> Value {
        let mut entry = json!({
            "kind": "calendar#calendarListEntry",
            "etag": self.etag(),
            "id": self.id,
            "summary": self.summary,
            "timeZone": self.zone.name(),
            "colorId": "14",
            "backgroundColor": self.background_color,
            "foregroundColor": "#000000",
            "accessRole": self.access_role,
            "defaultReminders": self.default_reminders,
            "conferenceProperties": { "allowedConferenceSolutionTypes": ["hangoutsMeet"] },
        });
        if let Some(description) = &self.description {
            entry["description"] = json!(description);
        }
        // Google omits both flags when false.
        if self.primary {
            entry["primary"] = json!(true);
        }
        if self.selected {
            entry["selected"] = json!(true);
        }
        entry
    }

    // -- writes --

    /// Stores an event as the calendar's next revision.
    pub(crate) fn store(&mut self, mut fields: Fields, now_ms: i64) -> &mut StoredEvent {
        self.revision += 1;
        fields.insert("etag".to_string(), json!(self.etag()));
        fields.insert("updated".to_string(), json!(timestamp(now_ms)));
        let id = text(&fields, "id").unwrap_or_default().to_string();
        let revision = self.revision;

        let stored = self.events.entry(id).or_insert_with(|| StoredEvent {
            fields: Fields::new(),
            revision,
            imported: false,
            removed_by_guest: false,
        });
        stored.fields = fields;
        stored.revision = revision;
        stored
    }

    /// Drops the exceptions of a series that no longer has their occurrence:
    /// the series was deleted, stopped repeating, or repeats at other times.
    pub(crate) fn prune_exceptions(&mut self, series_id: &str) {
        let kept: Vec<Point> = match self.events.get(series_id) {
            Some(series) if !series.is_cancelled() && series.is_recurring() => {
                match Span::of(&series.fields) {
                    Ok(span) => time::occurrence_starts(
                        span,
                        &recurrence(&series.fields),
                        Window::default(),
                    )
                    .unwrap_or_default(),
                    Err(_) => Vec::new(),
                }
            }
            _ => Vec::new(),
        };

        self.events.retain(|_, event| {
            if event.recurring_event_id() != Some(series_id) {
                return true;
            }
            original_start(&event.fields).is_some_and(|start| kept.contains(&start))
        });
    }

    // -- reads --

    /// A stored event, or the occurrence of a series an instance id names.
    pub(crate) fn event(&self, event_id: &str) -> Result<Fields, ApiError> {
        if let Some(event) = self.events.get(event_id) {
            return Ok(event.fields.clone());
        }

        let (series_id, suffix) = event_id.rsplit_once('_').ok_or_else(not_found)?;
        let start = Point::from_instance_suffix(suffix).ok_or_else(not_found)?;
        let series = self
            .events
            .get(series_id)
            .filter(|series| !series.is_cancelled() && series.is_recurring())
            .ok_or_else(not_found)?;
        let span = Span::of(&series.fields)?;
        let at = start.instant(self.zone);
        let window = Window {
            from: Some(at),
            until: Some(at),
        };
        let occurs =
            time::occurrence_starts(span, &recurrence(&series.fields), window)?.contains(&start);
        match occurs {
            true => Ok(instance(&series.fields, span, start)),
            false => Err(not_found()),
        }
    }

    /// `events.list`.
    pub(crate) fn list(&mut self, viewer: &str, query: &ListQuery) -> Result<Value, ApiError> {
        let zone = query.zone.unwrap_or(self.zone);
        let mut items = match &query.sync_token {
            Some(token) => self.changes_since(token, query)?,
            None => self.matching(query)?,
        };
        if query.order_by_start {
            items.sort_by_key(|fields| {
                Span::of(fields).map_or(DateTime::<Utc>::MAX_UTC, |span| span.start.instant(zone))
            });
        }

        let total = items.len();
        let page: Vec<Value> = items
            .into_iter()
            .skip(query.offset)
            .take(query.page_size)
            .map(|fields| self.render(viewer, fields, zone))
            .collect();
        let end = query.offset + page.len();

        let mut response = json!({
            "kind": "calendar#events",
            "etag": self.etag(),
            "summary": self.summary,
            "updated": timestamp(Utc::now().timestamp_millis()),
            "timeZone": zone.name(),
            "accessRole": self.access_role,
            "defaultReminders": self.default_reminders,
            "items": page,
        });
        match end < total {
            true => response["nextPageToken"] = json!(end.to_string()),
            // Only the last page carries the token to continue from.
            false => response["nextSyncToken"] = json!(self.issue_sync_token(query)),
        }
        Ok(response)
    }

    fn issue_sync_token(&mut self, query: &ListQuery) -> String {
        let from = match &query.sync_token {
            Some(token) => self.sync_tokens.get(token).and_then(|cursor| cursor.from),
            None => query.window.from,
        };
        self.sync_tokens_issued += 1;
        let token = format!("sync-{}-{}", self.revision, self.sync_tokens_issued);
        self.sync_tokens.insert(
            token.clone(),
            SyncCursor {
                revision: self.revision,
                from,
            },
        );
        token
    }

    /// Forgets every sync token handed out, so the next incremental sync
    /// answers 410 and the client must list everything again.
    pub(crate) fn expire_sync_tokens(&mut self) {
        self.sync_tokens.clear();
    }

    /// The events changed since a sync token, deleted ones included.
    fn changes_since(&self, token: &str, query: &ListQuery) -> Result<Vec<Fields>, ApiError> {
        let filtered =
            query.window != Window::default() || query.ical_uid.is_some() || query.order_by_start;
        if filtered {
            return Err(ApiError::calendar(
                400,
                "invalid",
                "Sync token cannot be used with other filters.",
            ));
        }
        if query.single_events {
            return Err(ApiError::calendar(
                400,
                "invalid",
                "The emulator does not expand recurring events in a sync-token listing.",
            ));
        }
        let cursor = self.sync_tokens.get(token).ok_or_else(|| {
            ApiError::calendar(
                410,
                "fullSyncRequired",
                "Sync token is no longer valid, a full sync is required.",
            )
        })?;
        let window = Window {
            from: cursor.from,
            until: None,
        };

        let mut changed: Vec<&StoredEvent> = self
            .events
            .values()
            .filter(|event| event.revision > cursor.revision)
            .filter(|event| event.is_cancelled() || self.in_window(event, window))
            .collect();
        changed.sort_by_key(|event| event.revision);
        Ok(changed
            .into_iter()
            .map(|event| match event.is_cancelled() {
                true => tombstone(&event.fields),
                false => event.fields.clone(),
            })
            .collect())
    }

    /// Whether an event, or any occurrence of a series, lies in a window.
    fn in_window(&self, event: &StoredEvent, window: Window) -> bool {
        let Ok(span) = Span::of(&event.fields) else {
            return false;
        };
        if !event.is_recurring() {
            return span.overlaps(window, self.zone);
        }
        time::occurrence_starts(span, &recurrence(&event.fields), window)
            .unwrap_or_default()
            .into_iter()
            .any(|start| span.starting_at(start).overlaps(window, self.zone))
    }

    /// The events a listing without a sync token answers.
    fn matching(&self, query: &ListQuery) -> Result<Vec<Fields>, ApiError> {
        if query.order_by_start && !query.single_events {
            return Err(ApiError::calendar(
                400,
                "invalid",
                "The requested ordering is not available for the particular query.",
            ));
        }

        let mut items = Vec::new();
        for event in self.events.values() {
            let wanted_uid = query
                .ical_uid
                .as_deref()
                .is_none_or(|uid| text(&event.fields, "iCalUID") == Some(uid));
            if !wanted_uid {
                continue;
            }

            if event.recurring_event_id().is_some() {
                // With recurring events expanded, exceptions are listed with
                // their series below.
                if !query.single_events {
                    items.extend(self.listed_exception(event, query));
                }
                continue;
            }
            if event.is_cancelled() {
                if query.show_deleted {
                    items.push(tombstone(&event.fields));
                }
                continue;
            }

            match (event.is_recurring(), query.single_events) {
                (true, true) => {
                    items.extend(self.instances(event, query.window, query.show_deleted)?);
                }
                (_, _) => {
                    if self.in_window(event, query.window) {
                        items.push(event.fields.clone());
                    }
                }
            }
        }
        Ok(items)
    }

    /// An exception as an unexpanded listing shows it. Google lists the
    /// cancelled occurrences of a live series even without `showDeleted`.
    fn listed_exception(&self, exception: &StoredEvent, query: &ListQuery) -> Option<Fields> {
        if exception.is_cancelled() {
            let at = original_start(&exception.fields)?.instant(self.zone);
            let listed = query.window.from.is_none_or(|from| at >= from)
                && query.window.until.is_none_or(|until| at < until);
            return listed.then(|| tombstone(&exception.fields));
        }
        self.in_window(exception, query.window)
            .then(|| exception.fields.clone())
    }

    /// The occurrences of a series in a window: the ones the rule yields,
    /// with each exception in place of the occurrence it replaces.
    pub(crate) fn instances(
        &self,
        series: &StoredEvent,
        window: Window,
        show_deleted: bool,
    ) -> Result<Vec<Fields>, ApiError> {
        let span = Span::of(&series.fields)?;
        let series_id = text(&series.fields, "id").unwrap_or_default();
        let mut items = Vec::new();

        for start in time::occurrence_starts(span, &recurrence(&series.fields), window)? {
            let id = format!("{series_id}_{}", start.instance_suffix());
            let replaced = self.events.contains_key(&id);
            if !replaced && span.starting_at(start).overlaps(window, self.zone) {
                items.push(instance(&series.fields, span, start));
            }
        }

        for exception in self.events.values() {
            if exception.recurring_event_id() != Some(series_id) {
                continue;
            }
            if exception.is_cancelled() {
                if show_deleted {
                    items.push(tombstone(&exception.fields));
                }
            } else if self.in_window(exception, window) {
                items.push(exception.fields.clone());
            }
        }

        Ok(items)
    }

    /// An event as its viewer sees it: who they are in it, and its times in
    /// the zone asked for.
    pub(crate) fn render(&self, viewer: &str, mut fields: Fields, zone: Tz) -> Value {
        if text(&fields, "status") == Some(CANCELLED) && !fields.contains_key("start") {
            return Value::Object(fields);
        }

        let organizes = organizer_email(&fields).is_some_and(|email| email == self.id);
        if let Some(organizer) = fields.get_mut("organizer").and_then(Value::as_object_mut)
            && organizes
        {
            organizer.insert("self".to_string(), json!(true));
        }
        if let Some(creator) = fields.get_mut("creator").and_then(Value::as_object_mut)
            && text(creator, "email").is_some_and(|email| email.eq_ignore_ascii_case(viewer))
        {
            creator.insert("self".to_string(), json!(true));
        }

        // A guest of an event whose organizer hides the guest list sees only
        // the organizer and themselves.
        let hidden = !organizes && !guest_switch(&fields, "guestsCanSeeOtherGuests", true);
        if let Some(attendees) = fields.get_mut("attendees").and_then(Value::as_array_mut) {
            for attendee in attendees.iter_mut() {
                let is_viewer = attendee_email(attendee)
                    .is_some_and(|email| email.eq_ignore_ascii_case(viewer));
                if is_viewer && let Some(attendee) = attendee.as_object_mut() {
                    attendee.insert("self".to_string(), json!(true));
                }
            }
            if hidden {
                attendees.retain(|attendee| {
                    attendee.get("self") == Some(&json!(true))
                        || attendee.get("organizer") == Some(&json!(true))
                });
            }
        }
        if hidden && fields.contains_key("attendees") {
            fields.insert("attendeesOmitted".to_string(), json!(true));
        }

        for name in ["start", "end", "originalStartTime"] {
            let Some(point) = fields.get(name).and_then(time::parse_point) else {
                continue;
            };
            fields.insert(name.to_string(), point.0.json(zone, point.1));
        }

        Value::Object(fields)
    }
}

/// The start of the occurrence an exception replaces.
pub(crate) fn original_start(fields: &Fields) -> Option<Point> {
    fields
        .get("originalStartTime")
        .and_then(time::parse_point)
        .map(|(start, _)| start)
}

/// One occurrence of a series, as Google expands it.
pub(crate) fn instance(series: &Fields, span: Span, start: Point) -> Fields {
    let mut fields = series.clone();
    let series_id = text(series, "id").unwrap_or_default().to_string();
    let moved = span.starting_at(start);

    fields.remove("recurrence");
    fields.insert(
        "id".to_string(),
        json!(format!("{series_id}_{}", start.instance_suffix())),
    );
    fields.insert("recurringEventId".to_string(), json!(series_id));
    fields.insert(
        "originalStartTime".to_string(),
        start.json(Tz::UTC, span.zone),
    );
    fields.insert("start".to_string(), moved.start.json(Tz::UTC, span.zone));
    fields.insert("end".to_string(), moved.end.json(Tz::UTC, span.end_zone));
    fields
}

/// What Google reports of a deleted event in a listing: little more than
/// its id.
fn tombstone(fields: &Fields) -> Fields {
    let mut tombstone = Fields::new();
    for name in [
        "kind",
        "etag",
        "id",
        "status",
        "recurringEventId",
        "originalStartTime",
    ] {
        if let Some(value) = fields.get(name) {
            tombstone.insert(name.to_string(), value.clone());
        }
    }
    tombstone
}

/// A calendar at a glance, for the control API.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct CalendarSummary {
    /// The calendar id: the user's address for their primary calendar.
    pub id: String,
    /// Its name.
    pub summary: String,
    /// Whether it is the user's primary calendar.
    pub primary: bool,
    /// What the user may do with it.
    pub access_role: AccessRole,
    /// Its time zone.
    pub time_zone: String,
    /// How many events it holds, deleted ones and exceptions included.
    pub events: usize,
    /// How many changes its events have seen.
    pub revision: u64,
    /// The push channels watching it.
    pub channels: Vec<ChannelSummary>,
}

/// A push channel at a glance.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct ChannelSummary {
    /// The id the client gave the channel.
    pub id: String,
    /// The id Google gives the watched resource.
    pub resource_id: String,
    /// The webhook notifications are posted to.
    pub address: String,
    /// When it stops notifying.
    pub expires_at: Option<DateTime<Utc>>,
}

impl Calendar {
    pub(crate) fn summarize(&self) -> CalendarSummary {
        CalendarSummary {
            id: self.id.clone(),
            summary: self.summary.clone(),
            primary: self.primary,
            access_role: self.access_role,
            time_zone: self.zone.name().to_string(),
            events: self.events.len(),
            revision: self.revision,
            channels: self
                .channels
                .iter()
                .map(|channel| ChannelSummary {
                    id: channel.id.clone(),
                    resource_id: channel.resource_id.clone(),
                    address: channel.address.clone(),
                    expires_at: DateTime::from_timestamp_millis(channel.expires_at_ms),
                })
                .collect(),
        }
    }
}
