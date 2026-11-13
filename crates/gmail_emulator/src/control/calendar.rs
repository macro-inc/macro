//! The control API for Google Calendar: what a test or a person uses to put
//! events on a calendar, change them as their owner or a guest would in
//! Google's own interface, and see what the emulator holds.

use axum::extract::{Path, State as AxumState};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::done;
use crate::calendar::{Actor, CalendarSummary, WriteOptions};
use crate::seed::{NewEvent, SeedCalendar};
use crate::{ChannelDelivery, EmulatorError, FaultError, GmailEmulator};

type Emulator = AxumState<GmailEmulator>;

/// An attendee's answer to an invitation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, strum::Display)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum AttendeeResponse {
    /// Not answered yet.
    NeedsAction,
    /// Yes.
    Accepted,
    /// Maybe.
    Tentative,
    /// No.
    Declined,
}

impl GmailEmulator {
    /// The calendars on a user's list.
    pub fn calendars(&self, email: &str) -> Result<Vec<CalendarSummary>, EmulatorError> {
        let mut state = self.lock();
        let mailbox = state.mailbox_mut(email)?;
        Ok(mailbox
            .calendars
            .values()
            .map(|calendar| calendar.summarize())
            .collect())
    }

    /// Adds a calendar to a user's list, or describes their primary
    /// calendar while it is empty. Returns the calendar id.
    pub fn add_calendar(
        &self,
        email: &str,
        calendar: &SeedCalendar,
    ) -> Result<String, EmulatorError> {
        self.with_state(|state| {
            let id = state.add_calendar(email, calendar)?;
            state.invite_to_existing_meetings(&email.to_lowercase());
            Ok(id)
        })
    }

    /// Every event a calendar holds as its owner reads it: series, their
    /// exceptions and deleted events, in the order they last changed.
    pub fn events(&self, email: &str, calendar_id: &str) -> Result<Vec<Value>, EmulatorError> {
        let email = email.to_lowercase();
        let mut state = self.lock();
        let calendar = state.calendar(&email, calendar_id)?;
        let mut events: Vec<_> = calendar.events.values().collect();
        events.sort_by_key(|event| event.revision);
        Ok(events
            .into_iter()
            .map(|event| calendar.render(&email, event.fields.clone(), calendar.zone))
            .collect())
    }

    /// Puts an event on a calendar, as whoever publishes it would in Google
    /// Calendar. Guests who are users here get it on their own calendars.
    pub fn add_event(
        &self,
        email: &str,
        calendar_id: &str,
        event: NewEvent,
    ) -> Result<Value, EmulatorError> {
        let email = email.to_lowercase();
        self.with_state(|state| {
            let options = WriteOptions::publisher();
            let fields = state.insert_event(&email, calendar_id, event.0, options)?;
            Ok(Value::Object(fields))
        })
    }

    /// Changes an event the way `events.patch` does. An instance id
    /// (`<series id>_<start>`) changes one occurrence of a series.
    pub fn change_event(
        &self,
        email: &str,
        calendar_id: &str,
        event_id: &str,
        change: NewEvent,
    ) -> Result<Value, EmulatorError> {
        let email = email.to_lowercase();
        self.with_state(|state| {
            let options = WriteOptions::publisher();
            let fields = state.patch_event(&email, calendar_id, event_id, change.0, options)?;
            Ok(Value::Object(fields))
        })
    }

    /// Deletes an event, or with an instance id one occurrence of a series.
    pub fn delete_event(
        &self,
        email: &str,
        calendar_id: &str,
        event_id: &str,
    ) -> Result<(), EmulatorError> {
        let email = email.to_lowercase();
        self.with_state(|state| {
            Ok(state.delete_event(&email, calendar_id, event_id, Actor::Publisher)?)
        })
    }

    /// Records an attendee's answer, as when they answer the invitation in
    /// their own calendar or mail, whether or not they are a user here.
    pub fn respond_to_event(
        &self,
        email: &str,
        calendar_id: &str,
        event_id: &str,
        attendee: &str,
        response: AttendeeResponse,
    ) -> Result<Value, EmulatorError> {
        let email = email.to_lowercase();
        self.with_state(|state| {
            let response = response.to_string();
            let fields = state.set_response(&email, calendar_id, event_id, attendee, &response)?;
            Ok(Value::Object(fields))
        })
    }

    /// Expires every sync token a calendar handed out: the next incremental
    /// `events.list` answers 410 `fullSyncRequired`.
    pub fn expire_sync_tokens(&self, email: &str, calendar_id: &str) -> Result<(), EmulatorError> {
        let email = email.to_lowercase();
        self.with_state(|state| {
            state.calendar(&email, calendar_id)?.expire_sync_tokens();
            Ok(())
        })
    }

    /// Makes `events.list` of one calendar answer `error` until it is
    /// called with `None`: one calendar of an account that Google cannot
    /// serve while the others are fine. A fault cannot name a calendar.
    pub fn fail_calendar(
        &self,
        email: &str,
        calendar_id: &str,
        error: Option<FaultError>,
    ) -> Result<(), EmulatorError> {
        let email = email.to_lowercase();
        self.with_state(|state| {
            state.calendar(&email, calendar_id)?.failing = error;
            Ok(())
        })
    }

    /// Holds changes to meetings back from their other copies, as Google
    /// does for some seconds: until [`Self::release_event_copies`] a change
    /// shows only on the calendar it was made on.
    pub fn hold_event_copies(&self) {
        self.with_state(|state| state.hold_copies());
    }

    /// Carries the changes held since [`Self::hold_event_copies`] to the
    /// other copies of their meetings and stops holding.
    pub fn release_event_copies(&self) {
        self.with_state(|state| state.release_copies());
    }

    /// Every Calendar push notification delivered, or given up on, so far.
    pub fn channel_deliveries(&self) -> Vec<ChannelDelivery> {
        self.lock().channel_deliveries.clone()
    }

    /// Waits until at least `count` Calendar push notifications have
    /// finished, and returns them all.
    pub async fn wait_for_channel_deliveries(&self, count: usize) -> Vec<ChannelDelivery> {
        let mut changed = self.inner.changed.subscribe();
        loop {
            let deliveries = self.channel_deliveries();
            if deliveries.len() >= count {
                return deliveries;
            }
            if changed.changed().await.is_err() {
                return deliveries;
            }
        }
    }
}

pub(super) fn router() -> Router<GmailEmulator> {
    Router::new()
        .route(
            "/mailboxes/{email}/calendars",
            get(calendars).post(add_calendar),
        )
        .route(
            "/mailboxes/{email}/calendars/{calendar}/events",
            get(events).post(add_event),
        )
        .route(
            "/mailboxes/{email}/calendars/{calendar}/events/{event}",
            patch(change_event).delete(delete_event),
        )
        .route(
            "/mailboxes/{email}/calendars/{calendar}/events/{event}/responses",
            post(respond_to_event),
        )
        .route(
            "/mailboxes/{email}/calendars/{calendar}/sync-tokens/expire",
            post(expire_sync_tokens),
        )
        .route(
            "/mailboxes/{email}/calendars/{calendar}/failure",
            post(fail_calendar).delete(heal_calendar),
        )
        .route("/calendar/copies/hold", post(hold_event_copies))
        .route("/calendar/copies/release", post(release_event_copies))
        .route("/push/channel-deliveries", get(channel_deliveries))
}

async fn calendars(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(emulator.calendars(&email))
}

async fn add_calendar(
    AxumState(emulator): Emulator,
    Path(email): Path<String>,
    Json(calendar): Json<SeedCalendar>,
) -> Response {
    done(
        emulator
            .add_calendar(&email, &calendar)
            .map(|id| serde_json::json!({ "id": id })),
    )
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
    done(emulator.add_event(&email, &calendar, event))
}

async fn change_event(
    AxumState(emulator): Emulator,
    Path((email, calendar, event)): Path<(String, String, String)>,
    Json(change): Json<NewEvent>,
) -> Response {
    done(emulator.change_event(&email, &calendar, &event, change))
}

async fn delete_event(
    AxumState(emulator): Emulator,
    Path((email, calendar, event)): Path<(String, String, String)>,
) -> Response {
    done(emulator.delete_event(&email, &calendar, &event))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Answer {
    attendee: String,
    response: AttendeeResponse,
}

async fn respond_to_event(
    AxumState(emulator): Emulator,
    Path((email, calendar, event)): Path<(String, String, String)>,
    Json(answer): Json<Answer>,
) -> Response {
    done(emulator.respond_to_event(&email, &calendar, &event, &answer.attendee, answer.response))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Failure {
    error: FaultError,
}

async fn fail_calendar(
    AxumState(emulator): Emulator,
    Path((email, calendar)): Path<(String, String)>,
    Json(failure): Json<Failure>,
) -> Response {
    done(emulator.fail_calendar(&email, &calendar, Some(failure.error)))
}

async fn heal_calendar(
    AxumState(emulator): Emulator,
    Path((email, calendar)): Path<(String, String)>,
) -> Response {
    done(emulator.fail_calendar(&email, &calendar, None))
}

async fn hold_event_copies(AxumState(emulator): Emulator) -> Response {
    emulator.hold_event_copies();
    done(Ok::<_, EmulatorError>(()))
}

async fn release_event_copies(AxumState(emulator): Emulator) -> Response {
    emulator.release_event_copies();
    done(Ok::<_, EmulatorError>(()))
}

async fn expire_sync_tokens(
    AxumState(emulator): Emulator,
    Path((email, calendar)): Path<(String, String)>,
) -> Response {
    done(emulator.expire_sync_tokens(&email, &calendar))
}

async fn channel_deliveries(AxumState(emulator): Emulator) -> Json<Vec<ChannelDelivery>> {
    Json(emulator.channel_deliveries())
}
