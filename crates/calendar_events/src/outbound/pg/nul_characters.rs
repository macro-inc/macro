//! PostgreSQL text cannot hold U+0000: a `text` value with one fails with
//! SQLSTATE 22021 and a `jsonb` string with 22P05, however often the write is
//! retried. Provider events carry one now and then, in their text or in a
//! field of the raw payload Macro keeps, and the providers pass it through.
//! The Outlook sync retries the same event first after an error, so a write
//! that keeps failing holds back its whole calendar.
//!
//! Calendar clients show a NUL as nothing, so it is removed here, at the event
//! upsert every Google, Outlook and mutation write funnels through, as the
//! mail store does at its own write boundary. Identifiers are left as they
//! are: the providers mint them, and changing one would split an event from
//! its other copies.

use serde_json::Value;

use crate::domain::models::{AutomaticDeclinePolicy, CalendarAttendee, CalendarEventUpsert};

/// Removes the NUL characters from every provider and user text value an
/// event write stores, and from every string and object key of its raw
/// payload. One warning names the fields it changed (never their values) and
/// the event, so the provider data stays visible.
pub(super) fn remove_from_upsert(upsert: &mut CalendarEventUpsert) {
    let mut removed = Removed::default();
    let event = &mut upsert.event;
    removed.text(&mut event.title, "title");
    removed.opt(&mut event.description, "description");
    removed.opt(&mut event.location, "location");
    removed.opt(&mut event.organizer_name, "organizer_name");
    removed.opt(&mut event.organizer_email, "organizer_email");
    removed.opt(&mut event.creator_name, "creator_name");
    removed.opt(&mut event.creator_email, "creator_email");
    removed.opt(&mut event.conference_url, "conference_url");
    for line in &mut event.recurrence_lines {
        removed.text(line, "recurrence_lines");
    }
    removed.attendees(&mut event.attendees);
    for event_override in &mut upsert.overrides {
        removed.opt(&mut event_override.title, "overrides.title");
        removed.opt(&mut event_override.description, "overrides.description");
        removed.opt(&mut event_override.location, "overrides.location");
        if let Some(attendees) = &mut event_override.attendees {
            removed.attendees(attendees);
        }
        removed.decline(&mut event_override.automatic_decline);
    }
    let source = upsert.source.details_mut();
    removed.decline(&mut source.automatic_decline);
    removed.json(&mut source.raw_payload, "raw_payload");

    if !removed.fields.is_empty() {
        tracing::warn!(
            fields = ?removed.fields,
            calendar_id = %source.calendar_id,
            provider_event_id = %source.provider_event_id,
            "removing NUL characters from a calendar event"
        );
    }
}

/// The fields one event write removed NUL characters from.
#[derive(Default)]
struct Removed {
    fields: Vec<&'static str>,
}

impl Removed {
    fn text(&mut self, value: &mut String, field: &'static str) {
        if value.contains('\0') {
            value.retain(|character| character != '\0');
            if !self.fields.contains(&field) {
                self.fields.push(field);
            }
        }
    }

    fn opt(&mut self, value: &mut Option<String>, field: &'static str) {
        if let Some(value) = value {
            self.text(value, field);
        }
    }

    fn attendees(&mut self, attendees: &mut [CalendarAttendee]) {
        for attendee in attendees {
            self.text(&mut attendee.email, "attendees.email");
            self.opt(&mut attendee.display_name, "attendees.display_name");
            self.opt(&mut attendee.comment, "attendees.comment");
        }
    }

    fn decline(&mut self, policy: &mut Option<AutomaticDeclinePolicy>) {
        if let Some(policy) = policy {
            self.opt(
                &mut policy.properties.decline_message,
                "automatic_decline.decline_message",
            );
        }
    }

    fn json(&mut self, value: &mut Value, field: &'static str) {
        match value {
            Value::String(text) => self.text(text, field),
            Value::Array(items) => {
                for item in items {
                    self.json(item, field);
                }
            }
            Value::Object(fields) => {
                if fields.keys().any(|key| key.contains('\0')) {
                    *fields = std::mem::take(fields)
                        .into_iter()
                        .map(|(mut key, value)| {
                            self.text(&mut key, field);
                            (key, value)
                        })
                        .collect();
                }
                for value in fields.values_mut() {
                    self.json(value, field);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }
}
