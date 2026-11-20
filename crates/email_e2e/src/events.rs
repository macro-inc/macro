//! Calendar events for scenarios to put on a provider's calendar.

use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};

/// The start of the hour `days` days from now: a time that is the same on
/// every read of one scenario and falls inside the window sync keeps.
pub fn hour_in_days(days: i64) -> DateTime<Utc> {
    let at = Utc::now() + Duration::days(days);
    DateTime::from_timestamp(at.timestamp() - at.timestamp().rem_euclid(3600), 0).unwrap_or(at)
}

/// An hour-long Google event titled `title`.
pub fn google(title: &str, start: DateTime<Utc>) -> gmail_emulator::NewEvent {
    google_with(title, start, json!({}))
}

/// An hour-long Google event with more of Google's event fields, which
/// replace the ones set here (`start` and `end` included).
pub fn google_with(title: &str, start: DateTime<Utc>, fields: Value) -> gmail_emulator::NewEvent {
    let mut event = json!({
        "summary": title,
        "start": { "dateTime": start.to_rfc3339() },
        "end": { "dateTime": (start + Duration::hours(1)).to_rfc3339() },
    });
    merge(&mut event, fields);
    gmail_emulator::NewEvent::from_json(event)
}

/// An hour-long Outlook event titled `title`.
pub fn outlook(title: &str, start: DateTime<Utc>) -> outlook_emulator::NewEvent {
    outlook_with(title, start, json!({}))
}

/// An hour-long Outlook event with more of Graph's event properties, which
/// replace the ones set here (`start` and `end` included).
pub fn outlook_with(
    title: &str,
    start: DateTime<Utc>,
    properties: Value,
) -> outlook_emulator::NewEvent {
    let mut event = json!({
        "subject": title,
        "start": graph_time(start),
        "end": graph_time(start + Duration::hours(1)),
    });
    merge(&mut event, properties);
    match event {
        Value::Object(properties) => outlook_emulator::NewEvent(properties),
        _ => outlook_emulator::NewEvent::default(),
    }
}

/// A time as Graph writes it: a local time and its zone, here UTC.
pub fn graph_time(at: DateTime<Utc>) -> Value {
    json!({ "dateTime": at.format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone": "UTC" })
}

fn merge(event: &mut Value, fields: Value) {
    if let (Some(event), Value::Object(fields)) = (event.as_object_mut(), fields) {
        event.extend(fields);
    }
}
