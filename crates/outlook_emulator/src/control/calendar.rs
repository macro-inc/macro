//! The calendar part of the control API: what a mailbox's calendars hold,
//! and the changes its owner or a meeting's other people make in Outlook.

use axum::extract::{Path, State as AxumState};
use axum::response::Response;
use axum::routing::{get, patch, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::done;
use crate::calendar::{self, Answer, Calendars, Listing, Writer, event_resource};
use crate::odata::Query;
use crate::seed::NewEvent;
use crate::{EmulatorError, OutlookEmulator};

type Emulator = AxumState<OutlookEmulator>;

/// What [`OutlookEmulator::events`] lists of each changed occurrence.
const EXCEPTION_PROPERTIES: [&str; 7] = [
    "occurrenceId",
    "originalStart",
    "type",
    "subject",
    "start",
    "end",
    "isCancelled",
];

/// A calendar, in brief.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CalendarSummary {
    /// The calendar's Graph id.
    pub id: String,
    /// Its name.
    pub name: String,
    /// Whether it is the mailbox's default calendar.
    pub is_default: bool,
    /// Whether its owner can change it.
    pub can_edit: bool,
    /// How many events and series it holds.
    pub events: usize,
}

fn calendar_id(calendars: &Calendars, key: &str) -> Result<String, EmulatorError> {
    calendars
        .calendar(key)
        .map(|calendar| calendar.id.clone())
        .ok_or_else(|| EmulatorError::UnknownCalendar(key.to_string()))
}

impl OutlookEmulator {
    /// A mailbox's calendars, the default one first.
    pub fn calendars(&self, email: &str) -> Result<Vec<CalendarSummary>, EmulatorError> {
        self.with_state(|state| {
            let calendars = &state.mailbox(email)?.calendar;
            let mut summaries: Vec<CalendarSummary> = calendars
                .calendars
                .iter()
                .map(|calendar| CalendarSummary {
                    id: calendar.id.clone(),
                    name: calendar.name.clone(),
                    is_default: calendar.is_default,
                    can_edit: calendar.can_edit,
                    events: calendars
                        .events
                        .values()
                        .filter(|event| event.calendar_id == calendar.id)
                        .count(),
                })
                .collect();
            summaries.sort_by_key(|calendar| !calendar.is_default);
            Ok(summaries)
        })
    }

    /// The events and series a calendar holds, as Graph answers them, in
    /// the order they were created. A series lists its changed occurrences
    /// under `exceptionOccurrences` and its deleted ones under
    /// `cancelledOccurrences`. `calendar` is an id, a name or `default`.
    pub fn events(&self, email: &str, calendar: &str) -> Result<Vec<Value>, EmulatorError> {
        self.with_state(|state| {
            let calendars = &state.mailbox(email)?.calendar;
            let calendar = calendar_id(calendars, calendar)?;
            let names = |names: &[&str]| names.iter().map(|name| name.to_string()).collect();
            let query = Query {
                exceptions: Some(names(&EXCEPTION_PROPERTIES)),
                ..Query::default()
            };
            let mut events: Vec<_> = calendars
                .events
                .values()
                .filter(|event| event.calendar_id == calendar)
                .collect();
            events.sort_by_key(|event| event.created_seq);
            events
                .into_iter()
                .map(|event| {
                    let mut resource = event_resource(event, calendars, &query, Listing::One)
                        .map_err(|error| EmulatorError::InvalidEvent(error.message))?;
                    let cancelled: Vec<String> =
                        event.cancelled.keys().map(ToString::to_string).collect();
                    resource["cancelledOccurrences"] = json!(cancelled);
                    Ok(resource)
                })
                .collect()
        })
    }

    /// Adds an event to a calendar, as if its owner had in Outlook, or as
    /// if an invitation had arrived. Answers its id.
    pub fn add_event(
        &self,
        email: &str,
        calendar: &str,
        event: &NewEvent,
    ) -> Result<String, EmulatorError> {
        self.with_state(|state| {
            let now = state.now();
            let mailbox = state.mailbox(email)?;
            let owner = mailbox.email.clone();
            let calendar = calendar_id(&mailbox.calendar, calendar)?;
            let id = mailbox
                .calendar
                .create(&calendar, &event.0, Writer::Emulator, now)
                .map_err(|error| EmulatorError::InvalidEvent(error.message))?;
            calendar::share_with_guests(state, &owner, &id, now);
            Ok(id)
        })
    }

    /// Changes an event, a series or one occurrence of a series (by the
    /// occurrence's id), as if its owner had in Outlook. `change` holds
    /// the properties to write, as in a Graph `PATCH`.
    pub fn update_event(
        &self,
        email: &str,
        event_id: &str,
        change: &NewEvent,
    ) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let now = state.now();
            let mailbox = state.mailbox(email)?;
            let owner = mailbox.email.clone();
            let unknown = || EmulatorError::UnknownEvent(event_id.to_string());
            let (master, _) = mailbox.calendar.locate(event_id).ok_or_else(unknown)?;
            mailbox
                .calendar
                .patch(event_id, &change.0, Writer::Emulator, now)
                .map_err(|error| EmulatorError::InvalidEvent(error.message))?;
            calendar::share_with_guests(state, &owner, &master, now);
            Ok(())
        })
    }

    /// Deletes an event, a series or one occurrence of a series, as if its
    /// owner had in Outlook.
    pub fn delete_event(&self, email: &str, event_id: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let now = state.now();
            let owner = state.mailbox(email)?.email.clone();
            calendar::delete_event(state, &owner, event_id, now)
                .map_err(|_| EmulatorError::UnknownEvent(event_id.to_string()))
        })
    }

    /// Records an attendee's answer (`accepted`, `tentativelyAccepted` or
    /// `declined`) on the copy of a meeting this mailbox holds, as when
    /// someone outside the emulator answers the organizer's invitation.
    pub fn answer_event(
        &self,
        email: &str,
        event_id: &str,
        attendee: &str,
        response: &str,
    ) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let now = state.now();
            let calendars = &mut state.mailbox(email)?.calendar;
            let unknown = || EmulatorError::UnknownEvent(event_id.to_string());
            let (master, date) = calendars.locate(event_id).ok_or_else(unknown)?;
            let answer = Answer::parse(response)
                .ok_or_else(|| EmulatorError::InvalidEvent(format!("no answer {response}")))?;
            calendars
                .record_answer(&master, date, attendee, answer, now)
                .map_err(|error| EmulatorError::InvalidEvent(error.message))
        })
    }

    /// Sets the mailbox's `mailboxSettings.timeZone`.
    pub fn set_time_zone(&self, email: &str, time_zone: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            state.mailbox(email)?.calendar.time_zone = time_zone.to_string();
            Ok(())
        })
    }
}

pub(super) fn routes() -> Router<OutlookEmulator> {
    Router::new()
        .route("/mailboxes/{email}/calendars", get(calendars))
        .route(
            "/mailboxes/{email}/calendars/{calendar}/events",
            get(events).post(add_event),
        )
        .route(
            "/mailboxes/{email}/events/{id}",
            patch(update_event).delete(delete_event),
        )
        .route("/mailboxes/{email}/events/{id}/answers", post(answer_event))
        .route("/mailboxes/{email}/time-zone", put(set_time_zone))
}

async fn calendars(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(emulator.calendars(&email))
}

async fn events(
    AxumState(emulator): Emulator,
    Path((email, calendar)): Path<(String, String)>,
) -> Response {
    done(emulator.events(&email, &calendar))
}

async fn add_event(
    AxumState(emulator): Emulator,
    Path((email, calendar)): Path<(String, String)>,
    Json(event): Json<NewEvent>,
) -> Response {
    done(
        emulator
            .add_event(&email, &calendar, &event)
            .map(|id| json!({ "id": id })),
    )
}

async fn update_event(
    AxumState(emulator): Emulator,
    Path((email, id)): Path<(String, String)>,
    Json(change): Json<NewEvent>,
) -> Response {
    done(emulator.update_event(&email, &id, &change))
}

async fn delete_event(
    AxumState(emulator): Emulator,
    Path((email, id)): Path<(String, String)>,
) -> Response {
    done(emulator.delete_event(&email, &id))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EventAnswer {
    attendee: String,
    response: String,
}

async fn answer_event(
    AxumState(emulator): Emulator,
    Path((email, id)): Path<(String, String)>,
    Json(answer): Json<EventAnswer>,
) -> Response {
    done(emulator.answer_event(&email, &id, &answer.attendee, &answer.response))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TimeZone {
    time_zone: String,
}

async fn set_time_zone(
    AxumState(emulator): Emulator,
    Path(email): Path<String>,
    Json(zone): Json<TimeZone>,
) -> Response {
    done(emulator.set_time_zone(&email, &zone.time_zone))
}
