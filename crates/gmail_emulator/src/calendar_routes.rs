//! The Google Calendar REST API: `/calendar/v3/…`.

use axum::extract::{Path, Query, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde_json::{Value, json};

use crate::GmailEmulator;
use crate::calendar::{
    AccessRole, Actor, CALENDAR_LIST_SCOPES, EVENT_SCOPES, Fields, ListQuery, Span, Window,
    WriteOptions, not_found,
};
use crate::error::ApiError;
use crate::fault::{Fault, Route};
use crate::gate::{Params, mailbox_request};
use crate::state::State;

/// The API's path under the emulator's origin.
pub(crate) const BASE_PATH: &str = "/calendar/v3";
const CALENDAR_LIST_DEFAULT: usize = 100;
const CALENDAR_LIST_MAX: usize = 250;
const EVENTS_DEFAULT: usize = 250;
const EVENTS_MAX: usize = 2500;

type Emulator = AxumState<GmailEmulator>;
type Listed = Query<Vec<(String, String)>>;

pub(crate) fn router() -> Router<GmailEmulator> {
    let calendar = Router::new()
        .route("/users/me/calendarList", get(list_calendars))
        .route(
            "/calendars/{calendar}/events",
            get(list_events).post(insert_event),
        )
        .route("/calendars/{calendar}/events/import", post(import_event))
        .route("/calendars/{calendar}/events/watch", post(watch_events))
        .route(
            "/calendars/{calendar}/events/{event}",
            get(get_event).patch(patch_event).delete(delete_event),
        )
        .route(
            "/calendars/{calendar}/events/{event}/instances",
            get(list_instances),
        )
        .route("/channels/stop", post(stop_channel));

    Router::new().nest(BASE_PATH, calendar)
}

/// Refuses a token whose grant holds none of the scopes a method accepts.
fn authorize(state: &State, email: &str, accepted: &[&str]) -> Result<(), ApiError> {
    let granted = state
        .mailboxes
        .get(email)
        .is_some_and(|mailbox| accepted.iter().any(|scope| mailbox.has_scope(scope)));
    match granted {
        true => Ok(()),
        false => Err(ApiError::calendar(
            403,
            "insufficientPermissions",
            "Request had insufficient authentication scopes.",
        )),
    }
}

fn bad_request(message: &str) -> ApiError {
    ApiError::calendar(400, "badRequest", message)
}

fn instant(params: &Params, name: &str) -> Result<Option<DateTime<Utc>>, ApiError> {
    params
        .get(name)
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|instant| instant.with_timezone(&Utc))
                .map_err(|_| bad_request("Bad Request"))
        })
        .transpose()
}

fn zone(params: &Params) -> Result<Option<Tz>, ApiError> {
    params
        .get("timeZone")
        .map(|zone| {
            zone.parse::<Tz>()
                .map_err(|_| bad_request("Invalid time zone definition."))
        })
        .transpose()
}

fn window(params: &Params) -> Result<Window, ApiError> {
    Ok(Window {
        from: instant(params, "timeMin")?,
        until: instant(params, "timeMax")?,
    })
}

fn list_query(params: &Params) -> Result<ListQuery, ApiError> {
    let order_by_start = match params.get("orderBy") {
        None => false,
        Some("startTime") => true,
        Some(_) => return Err(bad_request("The emulator only orders events by startTime.")),
    };

    Ok(ListQuery {
        window: window(params)?,
        single_events: params.flag("singleEvents"),
        show_deleted: params.flag("showDeleted"),
        ical_uid: params.get("iCalUID").map(str::to_string),
        order_by_start,
        sync_token: params.get("syncToken").map(str::to_string),
        zone: zone(params)?,
        offset: params.offset()?,
        page_size: params.page_size("maxResults", EVENTS_DEFAULT, EVENTS_MAX),
    })
}

fn write_options(params: &Params) -> WriteOptions {
    WriteOptions {
        actor: Actor::Client,
        conference: params.get("conferenceDataVersion") == Some("1"),
    }
}

fn event_body(body: Value) -> Result<Fields, ApiError> {
    match body {
        Value::Object(fields) => Ok(fields),
        _ => Err(bad_request("Bad Request")),
    }
}

/// An event as the token's user sees it on one of their calendars.
fn rendered(
    state: &mut State,
    email: &str,
    calendar_id: &str,
    fields: Fields,
    zone: Option<Tz>,
) -> Result<Json<Value>, ApiError> {
    let calendar = state.calendar(email, calendar_id)?;
    let zone = zone.unwrap_or(calendar.zone);
    Ok(Json(calendar.render(email, fields, zone)))
}

async fn list_calendars(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::CalendarListList,
        |state, email| {
            authorize(state, email, &CALENDAR_LIST_SCOPES)?;
            let least = match params.get("minAccessRole") {
                None => AccessRole::FreeBusyReader,
                Some(role) => role
                    .parse::<AccessRole>()
                    .map_err(|_| bad_request("Invalid minAccessRole."))?,
            };
            let offset = params.offset()?;
            let size = params.page_size("maxResults", CALENDAR_LIST_DEFAULT, CALENDAR_LIST_MAX);
            let mailbox = state.mailboxes.get(email).ok_or_else(not_found)?;
            let entries: Vec<Value> = mailbox
                .calendars
                .values()
                .filter(|calendar| calendar.access_role >= least)
                .map(|calendar| calendar.list_entry())
                .collect();

            let total = entries.len();
            let page: Vec<Value> = entries.into_iter().skip(offset).take(size).collect();
            let end = offset + page.len();
            let mut response = json!({
                "kind": "calendar#calendarList",
                "etag": format!("\"{total}\""),
                "items": page,
            });
            if end < total {
                response["nextPageToken"] = json!(end.to_string());
            }
            Ok(Json(response))
        },
    )
    .await
}

async fn list_events(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(calendar_id): Path<String>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsList,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            let query = list_query(&params)?;
            let calendar = state.calendar(email, &calendar_id)?;
            let broken = calendar.failing.and_then(|error| {
                State::fault_error(&Fault {
                    error: Some(error),
                    ..Fault::default()
                })
            });
            match broken {
                Some(error) => Err(error),
                None => calendar.list(email, &query).map(Json),
            }
        },
    )
    .await
}

async fn get_event(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((calendar_id, event_id)): Path<(String, String)>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsGet,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            let fields = state.calendar(email, &calendar_id)?.event(&event_id)?;
            rendered(state, email, &calendar_id, fields, zone(&params)?)
        },
    )
    .await
}

async fn list_instances(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((calendar_id, event_id)): Path<(String, String)>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsInstances,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            let window = window(&params)?;
            let offset = params.offset()?;
            let size = params.page_size("maxResults", EVENTS_DEFAULT, EVENTS_MAX);
            let calendar = state.calendar(email, &calendar_id)?;
            let zone = zone(&params)?.unwrap_or(calendar.zone);
            let event = calendar
                .events
                .get(&event_id)
                .filter(|event| !event.is_cancelled())
                .ok_or_else(not_found)?;

            // An event that does not repeat is its own only instance.
            let mut items = match event.is_recurring() {
                true => calendar.instances(event, window, params.flag("showDeleted"))?,
                false => vec![event.fields.clone()],
            };
            items.sort_by_key(|fields| {
                Span::of(fields).map_or(DateTime::<Utc>::MAX_UTC, |span| span.start.instant(zone))
            });

            let total = items.len();
            let page: Vec<Value> = items
                .into_iter()
                .skip(offset)
                .take(size)
                .map(|fields| calendar.render(email, fields, zone))
                .collect();
            let end = offset + page.len();
            let mut response = json!({
                "kind": "calendar#events",
                "summary": calendar.summary,
                "timeZone": zone.name(),
                "accessRole": calendar.access_role,
                "items": page,
            });
            if end < total {
                response["nextPageToken"] = json!(end.to_string());
            }
            Ok(Json(response))
        },
    )
    .await
}

async fn insert_event(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(calendar_id): Path<String>,
    Query(params): Listed,
    Json(body): Json<Value>,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsInsert,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            let options = write_options(&params);
            let fields = state.insert_event(email, &calendar_id, event_body(body)?, options)?;
            rendered(state, email, &calendar_id, fields, None)
        },
    )
    .await
}

async fn import_event(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(calendar_id): Path<String>,
    Query(params): Listed,
    Json(body): Json<Value>,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsImport,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            let options = write_options(&params);
            let fields = state.import_event(email, &calendar_id, event_body(body)?, options)?;
            rendered(state, email, &calendar_id, fields, None)
        },
    )
    .await
}

async fn patch_event(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((calendar_id, event_id)): Path<(String, String)>,
    Query(params): Listed,
    Json(body): Json<Value>,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsPatch,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            let options = write_options(&params);
            let fields =
                state.patch_event(email, &calendar_id, &event_id, event_body(body)?, options)?;
            rendered(state, email, &calendar_id, fields, None)
        },
    )
    .await
}

async fn delete_event(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((calendar_id, event_id)): Path<(String, String)>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsDelete,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            state.delete_event(email, &calendar_id, &event_id, Actor::Client)?;
            Ok(StatusCode::NO_CONTENT)
        },
    )
    .await
}

async fn watch_events(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(calendar_id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let events_url = format!(
        "{}/calendars/{calendar_id}/events?alt=json",
        emulator.calendar_url()
    );
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::EventsWatch,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            state
                .watch_events(email, &calendar_id, events_url, &body)
                .map(Json)
        },
    )
    .await
}

async fn stop_channel(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::ChannelsStop,
        |state, email| {
            authorize(state, email, &EVENT_SCOPES)?;
            state.stop_channel(email, &body)?;
            Ok(StatusCode::NO_CONTENT)
        },
    )
    .await
}
