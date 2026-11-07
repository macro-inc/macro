//! Creating, changing, deleting and answering events, as Graph applies a
//! client's JSON.

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde_json::{Map, Value, json};

use super::time::{self, LocalTime, Recurrence};
use super::{Calendars, Event, Exception, Response};
use crate::error::GraphError;
use crate::mailbox::{Address, normalize_html};

/// The properties of an event a client may write.
const WRITABLE: [&str; 21] = [
    "subject",
    "body",
    "start",
    "end",
    "isAllDay",
    "location",
    "locations",
    "attendees",
    "recurrence",
    "sensitivity",
    "showAs",
    "importance",
    "categories",
    "isReminderOn",
    "reminderMinutesBeforeStart",
    "responseRequested",
    "allowNewTimeProposals",
    "hideAttendees",
    "isOnlineMeeting",
    "onlineMeetingProvider",
    "transactionId",
];
const PROPERTIES: &str = "singleValueExtendedProperties";
/// What only a seed or the control API may say about an event: what
/// Exchange decides, or what someone else did to the meeting.
const SEEDABLE: [&str; 9] = [
    "organizer",
    "responseStatus",
    "iCalUId",
    "originalStartTimeZone",
    "originalEndTimeZone",
    "onlineMeeting",
    "onlineMeetingUrl",
    "isCancelled",
    "hasAttachments",
];
const EXCEPTIONS: &str = "exceptions";
const CANCELLED: &str = "cancelledOccurrences";
const RAW: &str = "raw";
const EXCEPTION_DATE: &str = "date";
const TEAMS: &str = "teamsForBusiness";
/// The class of the block Teams writes into a meeting's body.
const TEAMS_BLOCK_CLASS: &str = "me-email-text";
const UNANSWERED_TIME: &str = "0001-01-01T00:00:00Z";

/// Who is writing: Graph's client, or a seed and the control API, which may
/// also set what Exchange decides.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Writer {
    Client,
    Emulator,
}

/// An answer to a meeting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Answer {
    Accepted,
    Tentative,
    Declined,
}

impl Answer {
    /// Graph's `responseType`.
    pub(crate) fn response(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Tentative => "tentativelyAccepted",
            Self::Declined => "declined",
        }
    }

    pub(crate) fn parse(text: &str) -> Option<Self> {
        match text {
            "accepted" | "accept" => Some(Self::Accepted),
            "tentativelyAccepted" | "tentativelyAccept" | "tentative" => Some(Self::Tentative),
            "declined" | "decline" => Some(Self::Declined),
            _ => None,
        }
    }
}

fn invalid(message: &str) -> GraphError {
    GraphError::server(400, "ErrorInvalidRequest", message)
}

fn property_error(name: &str) -> GraphError {
    GraphError::server(
        400,
        "ErrorPropertyValidationFailure",
        &format!("At least one property failed validation: '{name}'."),
    )
}

fn unknown_property(name: &str) -> GraphError {
    GraphError::server(
        400,
        "RequestBodyRead",
        &format!(
            "The property '{name}' does not exist on type 'Microsoft.OutlookServices.Event', \
             or the emulator does not let a client write it."
        ),
    )
}

fn defaults() -> Map<String, Value> {
    let fields = json!({
        "subject": "",
        "body": {"contentType": "html", "content": ""},
        "isAllDay": false,
        "location": location(""),
        "locations": [],
        "attendees": [],
        "recurrence": null,
        "sensitivity": "normal",
        "showAs": "busy",
        "importance": "normal",
        "categories": [],
        "isReminderOn": true,
        "reminderMinutesBeforeStart": 15,
        "responseRequested": true,
        "allowNewTimeProposals": true,
        "hideAttendees": false,
        "isOnlineMeeting": false,
        "onlineMeetingProvider": "unknown",
        "onlineMeeting": null,
        "onlineMeetingUrl": null,
        "transactionId": null,
        "isCancelled": false,
        "hasAttachments": false,
    });
    match fields {
        Value::Object(fields) => fields,
        _ => Map::new(),
    }
}

fn location(name: &str) -> Value {
    json!({"displayName": name, "locationType": "default", "uniqueIdType": "unknown"})
}

/// An attendee as Graph stores one. Someone already on the event keeps
/// their answer.
fn attendee(value: &Value, current: &[Value]) -> Result<Value, GraphError> {
    let address = Address::from_json(value).ok_or_else(|| property_error("attendees"))?;
    let kept = current.iter().find(|known| {
        known["emailAddress"]["address"]
            .as_str()
            .is_some_and(|known| known.eq_ignore_ascii_case(&address.address))
    });
    let status = match (value.get("status"), kept) {
        (Some(status), _) if status["response"].is_string() => status.clone(),
        (_, Some(kept)) => kept["status"].clone(),
        _ => json!({"response": "none", "time": UNANSWERED_TIME}),
    };
    Ok(json!({
        "type": value["type"].as_str().unwrap_or("required"),
        "status": status,
        "emailAddress": address.json()["emailAddress"],
    }))
}

/// Graph's `patternedRecurrence` with every property it answers.
fn recurrence(value: &Value, start: Option<&Value>) -> Result<Value, GraphError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    Recurrence::parse(value).map_err(|error| property_error(error.0))?;
    let mut stored = json!({
        "pattern": {
            "type": null, "interval": 1, "month": 0, "dayOfMonth": 0,
            "daysOfWeek": [], "firstDayOfWeek": "sunday", "index": "first",
        },
        "range": {
            "type": null, "startDate": null, "endDate": "0001-01-01",
            "recurrenceTimeZone": start.and_then(|start| start["timeZone"].as_str()).unwrap_or("UTC"),
            "numberOfOccurrences": 0,
        },
    });
    for part in ["pattern", "range"] {
        let given = value[part]
            .as_object()
            .ok_or_else(|| property_error(part))?;
        for (key, given) in given {
            if stored[part].get(key).is_none() {
                return Err(property_error(key));
            }
            stored[part][key] = given.clone();
        }
    }
    Ok(stored)
}

/// One written property, as Graph stores it.
fn stored(key: &str, value: &Value, fields: &Map<String, Value>) -> Result<Value, GraphError> {
    let wrong = || property_error(key);
    match key {
        "start" | "end" => {
            let at = LocalTime::parse(value).ok_or_else(wrong)?;
            Ok(json!({
                "dateTime": at.local.format("%Y-%m-%dT%H:%M:%S%.f").to_string(),
                "timeZone": value["timeZone"].as_str().unwrap_or("UTC"),
            }))
        }
        "body" => {
            let content = value["content"].as_str().unwrap_or_default();
            match value["contentType"].as_str().unwrap_or("text") {
                kind if kind.eq_ignore_ascii_case("html") => {
                    Ok(json!({"contentType": "html", "content": normalize_html(content)}))
                }
                _ => Ok(json!({"contentType": "text", "content": content})),
            }
        }
        "location" => Ok(location(value["displayName"].as_str().unwrap_or_default())),
        "attendees" => {
            let current = fields
                .get("attendees")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let given = value.as_array().ok_or_else(wrong)?;
            let attendees: Result<Vec<Value>, GraphError> = given
                .iter()
                .map(|value| attendee(value, &current))
                .collect();
            Ok(Value::Array(attendees?))
        }
        "recurrence" => recurrence(value, fields.get("start")),
        "isAllDay"
        | "isReminderOn"
        | "responseRequested"
        | "allowNewTimeProposals"
        | "hideAttendees"
        | "isOnlineMeeting"
        | "isCancelled"
        | "hasAttachments" => value.as_bool().map(Value::Bool).ok_or_else(wrong),
        "reminderMinutesBeforeStart" => value.as_i64().map(Value::from).ok_or_else(wrong),
        "categories" | "locations" => value.as_array().map(|_| value.clone()).ok_or_else(wrong),
        "subject" | "sensitivity" | "showAs" | "importance" | "onlineMeetingProvider" => {
            value.as_str().map(Value::from).ok_or_else(wrong)
        }
        _ => Ok(value.clone()),
    }
}

/// Writes a body's properties into an event's fields. Answers the extended
/// properties it carried.
fn apply(
    fields: &mut Map<String, Value>,
    body: &Map<String, Value>,
    writer: Writer,
    extra: &[&str],
) -> Result<BTreeMap<String, String>, GraphError> {
    let mut properties = BTreeMap::new();
    // Times first: a recurrence takes its zone from the start written with it.
    let mut keys: Vec<&String> = body.keys().collect();
    keys.sort_by_key(|key| !matches!(key.as_str(), "start" | "end"));
    for key in keys {
        let value = &body[key.as_str()];
        if key == PROPERTIES {
            for property in value.as_array().ok_or_else(|| property_error(PROPERTIES))? {
                let (Some(id), Some(value)) = (property["id"].as_str(), property["value"].as_str())
                else {
                    return Err(property_error(PROPERTIES));
                };
                properties.insert(id.to_string(), value.to_string());
            }
            continue;
        }
        if extra.contains(&key.as_str()) {
            continue;
        }
        let seedable = writer == Writer::Emulator && SEEDABLE.contains(&key.as_str());
        if !WRITABLE.contains(&key.as_str()) && !seedable {
            return Err(unknown_property(key));
        }
        let value = stored(key, value, fields)?;
        match key.as_str() {
            "start" if !body.contains_key("originalStartTimeZone") => {
                fields.insert("originalStartTimeZone".into(), value["timeZone"].clone());
            }
            "end" if !body.contains_key("originalEndTimeZone") => {
                fields.insert("originalEndTimeZone".into(), value["timeZone"].clone());
            }
            "location" => {
                let named = value["displayName"]
                    .as_str()
                    .is_some_and(|name| !name.is_empty());
                let locations = if named {
                    vec![value.clone()]
                } else {
                    Vec::new()
                };
                fields.insert("locations".into(), Value::Array(locations));
            }
            _ => {}
        }
        fields.insert(key.clone(), value);
    }
    Ok(properties)
}

/// Checks the times of an event after a write.
fn check_times(fields: &Map<String, Value>) -> Result<(), GraphError> {
    let read = |key: &str| {
        fields
            .get(key)
            .and_then(LocalTime::parse)
            .ok_or_else(|| property_error(key))
    };
    let (start, end) = (read("start")?, read("end")?);
    if end.instant() < start.instant() {
        return Err(GraphError::server(
            400,
            "ErrorCalendarEndDateIsEarlierThanStartDate",
            "The end date for the calendar item is earlier than the start date.",
        ));
    }
    let all_day = fields.get("isAllDay") == Some(&Value::Bool(true));
    let midnight = |at: LocalTime| at.local.time() == NaiveTime::MIN;
    if all_day && !(midnight(start) && midnight(end) && end.instant() > start.instant()) {
        return Err(invalid(
            "The Event.Start and Event.End properties for an all-day event need to be set to midnight.",
        ));
    }
    Ok(())
}

/// Makes the event a Teams meeting when it asks to be one: Exchange gives
/// it a join link and writes its own block into the body.
fn prepare_meeting(
    fields: &mut Map<String, Value>,
    id: &str,
    teams_allowed: bool,
) -> Result<(), GraphError> {
    let wanted = fields.get("isOnlineMeeting") == Some(&Value::Bool(true))
        && fields.get("onlineMeetingProvider").and_then(Value::as_str) == Some(TEAMS);
    let has_link = fields.get("onlineMeeting").is_some_and(Value::is_object);
    if !wanted || has_link {
        return Ok(());
    }
    if !teams_allowed {
        return Err(invalid(
            "The calendar does not allow the online meeting provider 'teamsForBusiness'.",
        ));
    }
    let join = format!("https://teams.microsoft.com/l/meetup-join/emulator/{id}");
    let block = format!(
        "<div class=\"{TEAMS_BLOCK_CLASS}\"><div>Microsoft Teams meeting</div>\
         <a href=\"{join}\">Join the meeting now</a></div>"
    );
    let content = fields
        .get("body")
        .and_then(|body| body["content"].as_str())
        .unwrap_or_default();
    let with_block = match content.rsplit_once("</body>") {
        Some((before, after)) => format!("{before}{block}</body>{after}"),
        None => normalize_html(&format!("{content}{block}")),
    };
    fields.insert(
        "body".into(),
        json!({"contentType": "html", "content": with_block}),
    );
    fields.insert("onlineMeeting".into(), json!({"joinUrl": join}));
    Ok(())
}

fn exception_date(value: &Value) -> Option<NaiveDate> {
    value.as_str()?.parse().ok()
}

impl Calendars {
    fn teams_allowed(&self, calendar_id: &str) -> bool {
        self.calendar(calendar_id).is_some_and(|calendar| {
            calendar
                .online_meeting_providers
                .iter()
                .any(|provider| provider == TEAMS)
        })
    }

    /// Creates an event from Graph's JSON. Answers its id: the existing
    /// event's when one already carries the body's `transactionId`.
    pub(crate) fn create(
        &mut self,
        calendar_id: &str,
        body: &Map<String, Value>,
        writer: Writer,
        now: DateTime<Utc>,
    ) -> Result<String, GraphError> {
        if let Some(transaction) = body.get("transactionId").filter(|id| id.is_string()) {
            let existing = self
                .events
                .values()
                .find(|event| event.fields.get("transactionId") == Some(transaction));
            if let Some(existing) = existing {
                return Ok(existing.id.clone());
            }
        }

        let mut fields = defaults();
        let extra: &[&str] = match writer {
            Writer::Client => &[],
            Writer::Emulator => &[EXCEPTIONS, CANCELLED, RAW],
        };
        let properties = apply(&mut fields, body, writer, extra)?;
        check_times(&fields)?;

        let id = self.new_id("event");
        prepare_meeting(&mut fields, &id, self.teams_allowed(calendar_id))?;
        let organizer = fields
            .remove("organizer")
            .and_then(|organizer| Address::from_json(&organizer))
            .unwrap_or_else(|| self.owner.clone());
        let organizes = organizer.address.eq_ignore_ascii_case(&self.owner.address);
        let response = match fields.remove("responseStatus") {
            Some(status) => Response {
                response: status["response"].as_str().unwrap_or("none").to_string(),
                time: status["time"]
                    .as_str()
                    .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
                    .map(|time| time.with_timezone(&Utc)),
            },
            None if organizes => Response::new("organizer"),
            None => Response::new("none"),
        };
        let ical_uid = match fields.remove("iCalUId") {
            Some(Value::String(uid)) => uid,
            _ => format!(
                "040000008200E00074C5B7101A82E00800000000{}",
                uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, id.as_bytes())
                    .simple()
                    .to_string()
                    .to_uppercase()
            ),
        };
        let seq = self.next_seq();
        let mut event = Event {
            id: id.clone(),
            calendar_id: calendar_id.to_string(),
            ical_uid,
            version: 1,
            created_seq: seq,
            changed_seq: seq,
            sequence: 0,
            created: now,
            modified: now,
            fields,
            properties,
            organizer,
            response,
            exceptions: BTreeMap::new(),
            cancelled: BTreeMap::new(),
            raw: Map::new(),
        };

        if writer == Writer::Emulator {
            if let Some(Value::Object(raw)) = body.get(RAW) {
                event.raw = raw.clone();
            }
            for date in body
                .get(CANCELLED)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let date = exception_date(date).ok_or_else(|| property_error(CANCELLED))?;
                event.cancelled.insert(date, seq);
            }
            for exception in body
                .get(EXCEPTIONS)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let patch = exception
                    .as_object()
                    .ok_or_else(|| property_error(EXCEPTIONS))?;
                let date = patch
                    .get(EXCEPTION_DATE)
                    .and_then(exception_date)
                    .ok_or_else(|| property_error(EXCEPTIONS))?;
                change_occurrence(&mut event, date, patch, writer, now)?;
            }
        }
        self.events.insert(id.clone(), event);
        Ok(id)
    }

    /// Changes an event, or one occurrence of a series, from Graph's JSON.
    pub(crate) fn patch(
        &mut self,
        id: &str,
        body: &Map<String, Value>,
        writer: Writer,
        now: DateTime<Utc>,
    ) -> Result<(), GraphError> {
        let (master, date) = self.locate(id).ok_or_else(GraphError::item_not_found)?;
        let teams_allowed = self
            .events
            .get(&master)
            .is_some_and(|event| self.teams_allowed(&event.calendar_id));
        let event = self
            .events
            .get_mut(&master)
            .ok_or_else(GraphError::item_not_found)?;
        match date {
            Some(date) => change_occurrence(event, date, body, writer, now)?,
            None => {
                let mut fields = event.fields.clone();
                let properties = apply(&mut fields, body, writer, &[])?;
                check_times(&fields)?;
                prepare_meeting(&mut fields, &master, teams_allowed)?;
                let moved = fields.get("start") != event.fields.get("start")
                    || fields.get("end") != event.fields.get("end");
                let pattern = |fields: &Map<String, Value>| {
                    fields
                        .get("recurrence")
                        .map(|recurrence| recurrence["pattern"].clone())
                };
                // A series that moves or repeats differently starts over:
                // Exchange drops what was changed on single occurrences.
                if moved || pattern(&fields) != pattern(&event.fields) {
                    event.exceptions.clear();
                    event.cancelled.clear();
                    event.sequence += 1;
                }
                event.fields = fields;
                event.properties.extend(properties);
            }
        }
        self.touch(&master, now);
        Ok(())
    }

    /// Records the owner's answer to a meeting, or to one occurrence of it.
    /// Declining removes it from the calendar, as Outlook does. Answers the
    /// stored event's id and the occurrence date answered.
    pub(crate) fn respond(
        &mut self,
        id: &str,
        answer: Answer,
        now: DateTime<Utc>,
    ) -> Result<(String, Option<NaiveDate>), GraphError> {
        let (master, date) = self.locate(id).ok_or_else(GraphError::item_not_found)?;
        let owner = self.owner.address.clone();
        let event = self
            .events
            .get_mut(&master)
            .ok_or_else(GraphError::item_not_found)?;
        if event.organizer.address.eq_ignore_ascii_case(&owner) {
            return Err(invalid(
                "Your request can't be completed. You can't respond to this meeting because \
                 you're the meeting organizer.",
            ));
        }
        let response = Response {
            response: answer.response().to_string(),
            time: Some(now),
        };
        match date {
            Some(date) => {
                let exception = event.exceptions.entry(date).or_default();
                let attendees = answered(&event.fields, exception, &owner, &response);
                exception.overrides.insert("attendees".into(), attendees);
                exception.response = Some(response);
                exception.version += 1;
                exception.modified = Some(now);
            }
            None => {
                let attendees = answered(&event.fields, &Exception::default(), &owner, &response);
                event.fields.insert("attendees".into(), attendees);
                event.response = response;
            }
        }
        match (answer, date) {
            (Answer::Declined, Some(date)) => self.cancel_occurrence(&master, date, now),
            (Answer::Declined, None) => {
                self.remove(&master);
            }
            _ => self.touch(&master, now),
        }
        Ok((master, date))
    }

    /// Records someone's answer on the copy of a meeting this mailbox
    /// holds: the organizer's, when a guest answers.
    pub(crate) fn record_answer(
        &mut self,
        id: &str,
        date: Option<NaiveDate>,
        attendee: &str,
        answer: Answer,
        now: DateTime<Utc>,
    ) -> Result<(), GraphError> {
        let event = self
            .events
            .get_mut(id)
            .ok_or_else(GraphError::item_not_found)?;
        let response = Response {
            response: answer.response().to_string(),
            time: Some(now),
        };
        match date {
            Some(date) => {
                let exception = event.exceptions.entry(date).or_default();
                let attendees = answered(&event.fields, exception, attendee, &response);
                exception.overrides.insert("attendees".into(), attendees);
                exception.version += 1;
                exception.modified = Some(now);
            }
            None => {
                let attendees = answered(&event.fields, &Exception::default(), attendee, &response);
                event.fields.insert("attendees".into(), attendees);
            }
        }
        self.touch(id, now);
        Ok(())
    }
}

/// An event's attendees, with one of them having answered. An occurrence
/// that already has attendees of its own keeps what they answered.
fn answered(
    fields: &Map<String, Value>,
    exception: &Exception,
    address: &str,
    response: &Response,
) -> Value {
    let mut attendees = exception
        .overrides
        .get("attendees")
        .or_else(|| fields.get("attendees"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for attendee in &mut attendees {
        let named = attendee["emailAddress"]["address"]
            .as_str()
            .is_some_and(|known| known.eq_ignore_ascii_case(address));
        if named {
            attendee["status"] = json!({
                "response": response.response,
                "time": response.time.map(time::stamp),
            });
        }
    }
    Value::Array(attendees)
}

/// Changes one occurrence of a series: what the body names becomes the
/// occurrence's own, and the rest still follows the series.
fn change_occurrence(
    event: &mut Event,
    date: NaiveDate,
    body: &Map<String, Value>,
    writer: Writer,
    now: DateTime<Utc>,
) -> Result<(), GraphError> {
    if body.contains_key("recurrence") {
        return Err(invalid(
            "The recurrence of a series cannot be changed on one of its occurrences.",
        ));
    }
    let exception: &Exception = &event.exceptions.get(&date).cloned().unwrap_or_default();
    let mut fields = event.fields.clone();
    fields.extend(exception.overrides.clone());
    // The series' own times are its first occurrence's: this occurrence is
    // checked against where it is now.
    if let Some(occurrence) = event.occurrence_on(date) {
        for (key, at) in [("start", occurrence.start), ("end", occurrence.end)] {
            if exception.overrides.contains_key(key) {
                continue;
            }
            if let Some(local) = fields
                .get(key)
                .and_then(|series| time::local_time(at, series))
            {
                fields.insert(key.into(), local);
            }
        }
    }
    let before = fields.clone();
    let properties = apply(&mut fields, body, writer, &[EXCEPTION_DATE])?;
    check_times(&fields)?;

    let mut exception = exception.clone();
    for (key, value) in fields {
        if before.get(&key) != Some(&value) {
            exception.overrides.insert(key, value);
        }
    }
    exception.properties.extend(properties);
    exception.version += 1;
    exception.modified = Some(now);
    event.exceptions.insert(date, exception);
    Ok(())
}
