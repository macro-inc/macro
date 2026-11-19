//! PostgreSQL text cannot hold U+0000: a `text` value with one fails with
//! SQLSTATE 22021 and a `jsonb` string with 22P05, however often the write is
//! retried. Provider events carry one now and then, in their text or in a
//! field of the raw payload Macro keeps, and the providers pass it through.
//! The Outlook sync retries the same event first after an error, so one such
//! character used to stop its whole calendar.
//!
//! Calendar clients show a NUL as nothing, so it is removed here, at the event
//! upsert every Google, Outlook and mutation write funnels through, as the
//! mail store does at its own write boundary. Identifiers are left as they
//! are: the providers mint them, and changing one would split an event from
//! its other copies.

use serde_json::Value;

use crate::domain::models::{CalendarAttendee, CalendarEventUpsert};

/// Removes the NUL characters from every provider text value an event write
/// stores, and from every string and object key of its raw payload.
pub(super) fn remove_from_upsert(upsert: &mut CalendarEventUpsert) {
    let event = &mut upsert.event;
    remove(&mut event.title, "title");
    remove_opt(&mut event.description, "description");
    remove_opt(&mut event.location, "location");
    remove_opt(&mut event.organizer_name, "organizer_name");
    remove_opt(&mut event.organizer_email, "organizer_email");
    remove_opt(&mut event.creator_name, "creator_name");
    remove_opt(&mut event.creator_email, "creator_email");
    remove_opt(&mut event.conference_url, "conference_url");
    for line in &mut event.recurrence_lines {
        remove(line, "recurrence_lines");
    }
    remove_from_attendees(&mut event.attendees);
    for event_override in &mut upsert.overrides {
        remove_opt(&mut event_override.title, "overrides.title");
        remove_opt(&mut event_override.description, "overrides.description");
        remove_opt(&mut event_override.location, "overrides.location");
        if let Some(attendees) = &mut event_override.attendees {
            remove_from_attendees(attendees);
        }
    }
    remove_from_json(&mut upsert.source.details_mut().raw_payload, "raw_payload");
}

fn remove_from_attendees(attendees: &mut [CalendarAttendee]) {
    for attendee in attendees {
        remove(&mut attendee.email, "attendees.email");
        remove_opt(&mut attendee.display_name, "attendees.display_name");
        remove_opt(&mut attendee.comment, "attendees.comment");
    }
}

/// Removes the NUL characters from a value, logging the field (never the
/// value) so the provider data stays visible.
fn remove(value: &mut String, field: &'static str) {
    if value.contains('\0') {
        tracing::warn!(field, "removing NUL characters from a calendar event value");
        value.retain(|character| character != '\0');
    }
}

fn remove_opt(value: &mut Option<String>, field: &'static str) {
    if let Some(value) = value {
        remove(value, field);
    }
}

fn remove_from_json(value: &mut Value, field: &'static str) {
    match value {
        Value::String(text) => remove(text, field),
        Value::Array(items) => {
            for item in items {
                remove_from_json(item, field);
            }
        }
        Value::Object(fields) => {
            if fields.keys().any(|key| key.contains('\0')) {
                *fields = std::mem::take(fields)
                    .into_iter()
                    .map(|(mut key, value)| {
                        remove(&mut key, field);
                        (key, value)
                    })
                    .collect();
            }
            for value in fields.values_mut() {
                remove_from_json(value, field);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}
