//! A meeting's copies: each guest who is a mailbox here holds their own
//! copy of the organizer's event, as in Exchange. The organizer's changes
//! reach the copies, and a guest's answer reaches the organizer's.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Map, Value, json};

use super::write::Answer;
use super::{Calendars, Event, Exception, Response};
use crate::error::GraphError;
use crate::state::State;

/// What a guest keeps on their own copy, whatever the organizer writes.
const GUEST_OWNED: [&str; 4] = [
    "isReminderOn",
    "reminderMinutesBeforeStart",
    "showAs",
    "categories",
];
const CANCELLED_PREFIX: &str = "Canceled: ";

/// The attendees of an event that have not declined, by address.
fn invited(event: &Event) -> Vec<String> {
    event
        .fields
        .get("attendees")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|attendee| attendee["status"]["response"].as_str() != Some("declined"))
        .filter_map(|attendee| attendee["emailAddress"]["address"].as_str())
        .map(str::to_lowercase)
        .collect()
}

/// The organizer's fields as a guest's copy holds them.
fn guest_fields(source: &Event, kept: Option<&Map<String, Value>>) -> Map<String, Value> {
    let mut fields = source.fields.clone();
    fields.insert("transactionId".into(), Value::Null);
    for key in GUEST_OWNED {
        if let Some(value) = kept.and_then(|kept| kept.get(key)) {
            fields.insert(key.to_string(), value.clone());
        }
    }
    fields
}

impl Calendars {
    /// Puts a copy of someone else's meeting on the default calendar.
    fn receive_copy(&mut self, source: &Event, now: DateTime<Utc>) {
        let Some(calendar_id) = self.default_calendar().map(|calendar| calendar.id.clone()) else {
            return;
        };
        let id = self.new_id("event");
        let seq = self.next_seq();
        let exceptions = source.exceptions.iter().map(|(date, exception)| {
            let copy = Exception {
                overrides: exception.overrides.clone(),
                version: 1,
                modified: exception.modified,
                ..Exception::default()
            };
            (*date, copy)
        });
        let event = Event {
            id: id.clone(),
            calendar_id,
            version: 1,
            created_seq: seq,
            changed_seq: seq,
            created: now,
            modified: now,
            fields: guest_fields(source, None),
            properties: Default::default(),
            response: Response::new("none"),
            exceptions: exceptions.collect(),
            cancelled: source.cancelled.keys().map(|date| (*date, seq)).collect(),
            raw: Map::new(),
            ..source.clone()
        };
        self.events.insert(id, event);
    }

    /// Brings a guest's copy up to date with the organizer's event.
    fn update_copy(&mut self, id: &str, source: &Event, now: DateTime<Utc>) {
        let seq = self.seq + 1;
        let Some(copy) = self.events.get_mut(id) else {
            return;
        };
        copy.fields = guest_fields(source, Some(&copy.fields));
        // A series the organizer moved or repeats differently starts over
        // for the guest too: what either changed on single occurrences goes.
        if copy.sequence != source.sequence {
            copy.exceptions.clear();
            copy.cancelled.clear();
        }
        copy.sequence = source.sequence;
        let mut exceptions = std::mem::take(&mut copy.exceptions);
        for (date, exception) in &source.exceptions {
            let own = exceptions.remove(date).unwrap_or_default();
            copy.exceptions.insert(
                *date,
                Exception {
                    overrides: exception.overrides.clone(),
                    version: own.version + 1,
                    modified: exception.modified,
                    ..own
                },
            );
        }
        // An occurrence only the guest answered keeps its answer.
        for (date, own) in exceptions {
            if own.response.is_some() {
                copy.exceptions.insert(date, own);
            }
        }
        for date in source.cancelled.keys() {
            copy.cancelled.entry(*date).or_insert(seq);
        }
        self.touch(id, now);
    }

    /// Marks a guest's copy cancelled. It stays on the calendar until the
    /// guest removes it, as in Outlook.
    fn cancel_copy(&mut self, id: &str, now: DateTime<Utc>) {
        let Some(copy) = self.events.get_mut(id) else {
            return;
        };
        if copy.fields.get("isCancelled") == Some(&Value::Bool(true)) {
            return;
        }
        let subject = copy
            .fields
            .get("subject")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let subject = format!("{CANCELLED_PREFIX}{subject}");
        copy.fields.insert("subject".into(), json!(subject));
        copy.fields.insert("isCancelled".into(), json!(true));
        self.touch(id, now);
    }
}

/// The id of a mailbox's copy of a meeting someone else organizes.
fn copy_of(calendars: &Calendars, uid: &str, organizer: &str) -> Option<String> {
    calendars
        .by_uid(uid)
        .filter(|copy| copy.organizer.address.eq_ignore_ascii_case(organizer))
        .map(|copy| copy.id.clone())
}

/// After the organizer created or changed a meeting: every guest who is a
/// mailbox here gets or updates their copy, and a guest taken off the
/// meeting has theirs cancelled.
pub(crate) fn share_with_guests(
    state: &mut State,
    organizer: &str,
    event_id: &str,
    now: DateTime<Utc>,
) {
    let source = state
        .mailboxes
        .get(organizer)
        .and_then(|mailbox| mailbox.calendar.events.get(event_id))
        .filter(|event| event.organizer.address.eq_ignore_ascii_case(organizer))
        .cloned();
    let Some(source) = source else {
        return;
    };
    let invited = invited(&source);
    for (email, mailbox) in &mut state.mailboxes {
        if email == organizer {
            continue;
        }
        let calendars = &mut mailbox.calendar;
        let copy = copy_of(calendars, &source.ical_uid, organizer);
        match (invited.contains(email), copy) {
            (true, None) => calendars.receive_copy(&source, now),
            (true, Some(copy)) => calendars.update_copy(&copy, &source, now),
            (false, Some(copy)) => calendars.cancel_copy(&copy, now),
            (false, None) => {}
        }
    }
}

/// After the organizer deleted a meeting: the guests' copies are cancelled.
pub(crate) fn cancel_guest_copies(
    state: &mut State,
    organizer: &str,
    deleted: &Event,
    now: DateTime<Utc>,
) {
    if !deleted.organizer.address.eq_ignore_ascii_case(organizer) {
        return;
    }
    for (email, mailbox) in &mut state.mailboxes {
        if email == organizer {
            continue;
        }
        if let Some(copy) = copy_of(&mailbox.calendar, &deleted.ical_uid, organizer) {
            mailbox.calendar.cancel_copy(&copy, now);
        }
    }
}

/// After a guest answered: the organizer's copy shows the answer, when the
/// organizer is a mailbox here.
pub(crate) fn answer_organizer(
    state: &mut State,
    guest: &str,
    organizer: &str,
    uid: &str,
    date: Option<NaiveDate>,
    answer: Answer,
    now: DateTime<Utc>,
) {
    let Some(mailbox) = state.mailboxes.get_mut(&organizer.to_lowercase()) else {
        return;
    };
    let Some(id) = copy_of(&mailbox.calendar, uid, organizer) else {
        return;
    };
    // The event exists, so recording the answer cannot fail.
    let _recorded = mailbox
        .calendar
        .record_answer(&id, date, guest, answer, now);
}

/// Deletes an event or an occurrence, and tells the meeting's guests.
pub(crate) fn delete_event(
    state: &mut State,
    email: &str,
    id: &str,
    now: DateTime<Utc>,
) -> Result<(), GraphError> {
    let calendars = &mut state
        .mailboxes
        .get_mut(email)
        .ok_or_else(GraphError::item_not_found)?
        .calendar;
    let (master, date) = calendars
        .locate(id)
        .ok_or_else(GraphError::item_not_found)?;
    match date {
        Some(date) => {
            calendars.cancel_occurrence(&master, date, now);
            share_with_guests(state, email, &master, now);
        }
        None => {
            if let Some(deleted) = calendars.remove(&master) {
                cancel_guest_copies(state, email, &deleted, now);
            }
        }
    }
    Ok(())
}
