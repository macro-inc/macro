//! Calendars and events: mailbox settings, the calendars, `calendarView`
//! and its delta, events and the instances of a series, and creating,
//! changing, deleting and answering them.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::{Map, Value, json};

use super::{Ctx, Handled, Reply};
use crate::calendar::{
    self, Answer, CalendarCursor, CalendarEntry, Calendars, Found, Listing, Writer,
    calendar_resource, event_resource, occurrence_resource,
};
use crate::error::GraphError;
use crate::odata::{Filter, Query};

const EVENT_ENTITY: &str = "users('me')/events";
const DEFAULT_DELTA_PAGE_SIZE: usize = 50;
const ODATA_TYPE: &str = "#microsoft.graph.event";

fn calendars<'a>(ctx: &'a mut Ctx<'_>) -> Result<&'a mut Calendars, GraphError> {
    Ok(&mut ctx.mailbox()?.calendar)
}

fn calendar_id(calendars: &Calendars, id: &str) -> Result<String, GraphError> {
    calendars
        .calendars
        .iter()
        .find(|calendar| calendar.id == id)
        .map(|calendar| calendar.id.clone())
        .ok_or_else(GraphError::item_not_found)
}

/// Graph's answer to a write on a calendar the owner can only read.
fn check_writable(calendars: &Calendars, calendar_id: &str) -> Result<(), GraphError> {
    let can_edit = calendars
        .calendar(calendar_id)
        .is_some_and(|calendar| calendar.can_edit);
    match can_edit {
        true => Ok(()),
        false => Err(GraphError::access_denied()),
    }
}

/// The `startDateTime` and `endDateTime` of a view.
fn window(ctx: &Ctx<'_>) -> Result<(DateTime<Utc>, DateTime<Utc>), GraphError> {
    let read = |name: &str| {
        let pairs = &ctx.call.pairs;
        let text = pairs
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str());
        let parsed = text.and_then(|text| {
            let zoned = DateTime::parse_from_rfc3339(text).map(|at| at.with_timezone(&Utc));
            let naive = || NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f");
            zoned.ok().or_else(|| naive().ok().map(|at| at.and_utc()))
        });
        parsed.ok_or_else(|| {
            GraphError::server(
                400,
                "ErrorInvalidParameter",
                "This request requires a time window specified by the query string parameters \
                 StartDateTime and EndDateTime.",
            )
        })
    };
    Ok((read("startDateTime")?, read("endDateTime")?))
}

pub(crate) fn mailbox_settings(ctx: &mut Ctx<'_>) -> Handled {
    let context = ctx.context("users('me')/mailboxSettings");
    let time_zone = calendars(ctx)?.time_zone.clone();
    Ok(Reply::Json(
        200,
        json!({
            "@odata.context": context,
            "archiveFolder": ctx.mailbox()?.well_known("archive").map(|folder| folder.id.clone()),
            "timeZone": time_zone,
            "delegateMeetingMessageDeliveryOptions": "sendToDelegateOnly",
            "dateFormat": "M/d/yyyy",
            "timeFormat": "h:mm tt",
            "userPurpose": "user",
            "automaticRepliesSetting": {
                "status": "disabled",
                "externalAudience": "all",
                "internalReplyMessage": "",
                "externalReplyMessage": "",
            },
            "language": {"locale": "en-US", "displayName": "English (United States)"},
            "workingHours": {
                "daysOfWeek": ["monday", "tuesday", "wednesday", "thursday", "friday"],
                "startTime": "08:00:00.0000000",
                "endTime": "17:00:00.0000000",
                "timeZone": {"name": time_zone},
            },
        }),
    ))
}

pub(crate) fn list_calendars(ctx: &mut Ctx<'_>) -> Handled {
    let calendars = calendars(ctx)?;
    let values: Vec<Value> = calendars
        .calendars
        .iter()
        .map(|calendar| calendar_resource(calendar, &calendars.owner))
        .collect();
    let (page, next) = ctx.page(values);
    Ok(ctx.collection("users('me')/calendars", page, next))
}

pub(crate) fn get_calendar(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let context = ctx.context("users('me')/calendars/$entity");
    let calendars = calendars(ctx)?;
    let id = calendar_id(calendars, id)?;
    let calendar = calendars
        .calendar(&id)
        .ok_or_else(GraphError::item_not_found)?;
    let mut resource = calendar_resource(calendar, &calendars.owner);
    resource["@odata.context"] = json!(context);
    Ok(Reply::Json(200, resource))
}

/// Graph's JSON for whatever an id names.
fn found_resource(
    calendars: &Calendars,
    found: &Found<'_>,
    query: &Query,
    listing: Listing,
) -> Result<Value, GraphError> {
    match found {
        Found::Event(event) => event_resource(event, calendars, query, listing),
        Found::Occurrence(occurrence) => occurrence_resource(occurrence, calendars, query, listing),
    }
}

/// `GET /me/calendars/{id}/events`: series masters and single events.
pub(crate) fn list_events(ctx: &mut Ctx<'_>, calendar: &str) -> Handled {
    let query = ctx.query.clone();
    let calendars = calendars(ctx)?;
    let calendar = calendar_id(calendars, calendar)?;
    let mut values = Vec::new();
    for event in calendars.events.values() {
        let wanted = match &query.filter {
            None => true,
            Some(Filter::Property { id, value }) => event.property(id).as_ref() == Some(value),
            Some(_) => {
                return Err(GraphError::bad_request(
                    "Invalid filter clause: the emulator filters events only by an extended property.",
                ));
            }
        };
        if event.calendar_id == calendar && wanted {
            values.push(event_resource(event, calendars, &query, Listing::Many)?);
        }
    }
    let (page, next) = ctx.page(values);
    Ok(ctx.collection(EVENT_ENTITY, page, next))
}

/// `GET /me/calendars/{id}/calendarView`: what the calendar shows in a
/// window, with every series expanded into its occurrences.
pub(crate) fn calendar_view(ctx: &mut Ctx<'_>, calendar: &str) -> Handled {
    let (from, to) = window(ctx)?;
    let query = ctx.query.clone();
    let calendars = calendars(ctx)?;
    let calendar = calendar_id(calendars, calendar)?;
    let mut values = Vec::new();
    for event in calendars.events.values() {
        if event.calendar_id != calendar {
            continue;
        }
        if !event.is_series() {
            if event.overlaps(from, to) {
                values.push(event_resource(event, calendars, &query, Listing::Many)?);
            }
            continue;
        }
        for occurrence in event.occurrences(from, to) {
            values.push(occurrence_resource(
                &occurrence,
                calendars,
                &query,
                Listing::Many,
            )?);
        }
    }
    let (page, next) = ctx.page(values);
    Ok(ctx.collection(EVENT_ENTITY, page, next))
}

/// `GET /me/events/{id}/instances`: a series' occurrences in a window.
pub(crate) fn instances(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let (from, to) = window(ctx)?;
    let query = ctx.query.clone();
    let calendars = calendars(ctx)?;
    let master = calendars
        .events
        .get(id)
        .ok_or_else(GraphError::item_not_found)?;
    if !master.is_series() {
        return Err(GraphError::server(
            400,
            "ErrorInvalidRequest",
            "The event is not a series master, so it has no instances.",
        ));
    }
    let mut values = Vec::new();
    for occurrence in master.occurrences(from, to) {
        values.push(occurrence_resource(
            &occurrence,
            calendars,
            &query,
            Listing::Many,
        )?);
    }
    let (page, next) = ctx.page(values);
    Ok(ctx.collection(EVENT_ENTITY, page, next))
}

fn encode_cursor(cursor: &CalendarCursor) -> String {
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(cursor).unwrap_or_default())
}

fn decode_cursor(token: &str) -> Option<CalendarCursor> {
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(token).ok()?).ok()
}

/// `GET /me/calendarView/delta`: the default calendar's view, and then
/// what changed in it since a delta token.
pub(crate) fn view_delta(ctx: &mut Ctx<'_>) -> Handled {
    let query = ctx.query.clone();
    let token = query.skip_token.as_ref().or(query.delta_token.as_ref());
    let cursor = match token {
        Some(token) => {
            let cursor = decode_cursor(token)
                .ok_or_else(|| GraphError::bad_request("The delta or skip token is malformed."))?;
            if !calendars(ctx)?.delta_token_valid(&cursor) {
                return Err(GraphError::sync_state_not_found());
            }
            cursor
        }
        None => {
            if query.filter.is_some() || query.order_by.is_some() || query.select.is_some() {
                return Err(GraphError::bad_request(
                    "The emulator's calendarView delta supports no $filter, $orderby or $select.",
                ));
            }
            let (from, to) = window(ctx)?;
            let page_size = query.top.unwrap_or(DEFAULT_DELTA_PAGE_SIZE);
            calendars(ctx)?.delta_start(from, to, page_size)
        }
    };

    let round = Query::default();
    let calendars = calendars(ctx)?;
    let page = calendars.view_delta(cursor);
    let mut values = Vec::new();
    for entry in &page.entries {
        values.push(match entry {
            CalendarEntry::Event(event) => {
                let mut value = event_resource(event, calendars, &round, Listing::Many)?;
                value["@odata.type"] = json!(ODATA_TYPE);
                value
            }
            CalendarEntry::Occurrence(occurrence) if occurrence.exception.is_some() => {
                let mut value = occurrence_resource(occurrence, calendars, &round, Listing::Many)?;
                value["@odata.type"] = json!(ODATA_TYPE);
                value
            }
            // An unchanged occurrence carries only what tells it apart.
            CalendarEntry::Occurrence(occurrence) => {
                let select = ["seriesMasterId", "type", "start", "end"];
                let only = Query {
                    select: Some(select.iter().map(|name| name.to_string()).collect()),
                    ..Query::default()
                };
                let mut value = occurrence_resource(occurrence, calendars, &only, Listing::Many)?;
                value["@odata.type"] = json!(ODATA_TYPE);
                value
            }
            CalendarEntry::Removed(id) => {
                json!({"@odata.type": ODATA_TYPE, "id": id, "@removed": {"reason": "deleted"}})
            }
        });
    }

    let (link, parameter) = match page.done {
        true => ("@odata.deltaLink", "$deltatoken"),
        false => ("@odata.nextLink", "$skiptoken"),
    };
    let pairs = [(parameter.to_string(), encode_cursor(&page.cursor))];
    let mut body = json!({"@odata.context": ctx.context("Collection(event)"), "value": values});
    body[link] = json!(ctx.link("me/calendarView/delta", &pairs));
    Ok(Reply::Json(200, body))
}

/// `GET /me/events/{id}`, or `/me/calendars/{id}/events/{id}`, which only
/// finds an event of that calendar.
pub(crate) fn get_event(ctx: &mut Ctx<'_>, calendar: Option<&str>, id: &str) -> Handled {
    let query = ctx.query.clone();
    let context = ctx.context("users('me')/events/$entity");
    let calendars = calendars(ctx)?;
    let found = calendars.find(id).ok_or_else(GraphError::item_not_found)?;
    if let Some(calendar) = calendar {
        let holder = match &found {
            Found::Event(event) => &event.calendar_id,
            Found::Occurrence(occurrence) => &occurrence.master.calendar_id,
        };
        if *holder != calendar_id(calendars, calendar)? {
            return Err(GraphError::item_not_found());
        }
    }
    let mut resource = found_resource(calendars, &found, &query, Listing::One)?;
    resource["@odata.context"] = json!(context);
    Ok(Reply::Json(200, resource))
}

fn body_object(ctx: &Ctx<'_>) -> Result<Map<String, Value>, GraphError> {
    match ctx.json_body()? {
        Value::Object(body) => Ok(body),
        _ => Err(GraphError::bad_request(
            "The request body must be a JSON object.",
        )),
    }
}

/// `POST /me/calendars/{id}/events`.
pub(crate) fn create_event(ctx: &mut Ctx<'_>, calendar: &str) -> Handled {
    let body = body_object(ctx)?;
    let (now, email) = (ctx.now, ctx.email.clone());
    let context = ctx.context("users('me')/events/$entity");
    let calendars = calendars(ctx)?;
    let calendar = calendar_id(calendars, calendar)?;
    check_writable(calendars, &calendar)?;
    let id = calendars.create(&calendar, &body, Writer::Client, now)?;
    calendar::share_with_guests(ctx.state, &email, &id, now);

    let calendars = self::calendars(ctx)?;
    let found = calendars.find(&id).ok_or_else(GraphError::item_not_found)?;
    let mut resource = found_resource(calendars, &found, &Query::default(), Listing::One)?;
    resource["@odata.context"] = json!(context);
    Ok(Reply::Json(201, resource))
}

/// `If-Match` must name the event's current version.
fn check_version(
    ctx: &Ctx<'_>,
    calendars: &Calendars,
    found: &Found<'_>,
) -> Result<(), GraphError> {
    let Some(expected) = ctx.call.if_match.as_deref().filter(|tag| *tag != "*") else {
        return Ok(());
    };
    let current = found_resource(calendars, found, &Query::default(), Listing::One)?;
    match current["@odata.etag"].as_str() == Some(expected) {
        true => Ok(()),
        false => Err(GraphError::changed_since_read()),
    }
}

/// What a write must hold before it runs: the event exists, its calendar
/// can be edited, and `If-Match` names its version. Answers the stored
/// event's id.
fn open_for_write(ctx: &mut Ctx<'_>, id: &str) -> Result<String, GraphError> {
    let mailbox = ctx
        .state
        .mailboxes
        .get(&ctx.email)
        .ok_or_else(GraphError::item_not_found)?;
    let calendars = &mailbox.calendar;
    let found = calendars.find(id).ok_or_else(GraphError::item_not_found)?;
    let master = match &found {
        Found::Event(event) => *event,
        Found::Occurrence(occurrence) => occurrence.master,
    };
    check_writable(calendars, &master.calendar_id)?;
    check_version(ctx, calendars, &found)?;
    Ok(master.id.clone())
}

/// `PATCH /me/events/{id}`: an event, a series, or one of its occurrences.
pub(crate) fn update_event(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let body = body_object(ctx)?;
    let (now, email) = (ctx.now, ctx.email.clone());
    let context = ctx.context("users('me')/events/$entity");
    let master = open_for_write(ctx, id)?;
    calendars(ctx)?.patch(id, &body, Writer::Client, now)?;
    calendar::share_with_guests(ctx.state, &email, &master, now);

    let calendars = calendars(ctx)?;
    let found = calendars.find(id).ok_or_else(GraphError::item_not_found)?;
    let mut resource = found_resource(calendars, &found, &Query::default(), Listing::One)?;
    resource["@odata.context"] = json!(context);
    Ok(Reply::Json(200, resource))
}

/// `DELETE /me/events/{id}`. Deleting an occurrence leaves the series.
pub(crate) fn delete_event(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let (now, email) = (ctx.now, ctx.email.clone());
    open_for_write(ctx, id)?;
    calendar::delete_event(ctx.state, &email, id, now)?;
    Ok(Reply::Empty(204))
}

/// `POST /me/events/{id}/accept`, `tentativelyAccept` and `decline`.
pub(crate) fn respond(
    ctx: &mut Ctx<'_>,
    calendar: Option<&str>,
    id: &str,
    action: &str,
) -> Handled {
    // The body's `sendResponse` and `comment` go to the organizer's inbox,
    // which the emulator does not write; the answer itself is recorded.
    body_object(ctx)?;
    let answer = Answer::parse(action).ok_or_else(|| GraphError::unknown_segment(action))?;
    let (now, email) = (ctx.now, ctx.email.clone());
    let calendars = calendars(ctx)?;
    let (master, _) = calendars
        .locate(id)
        .ok_or_else(GraphError::item_not_found)?;
    let event = calendars
        .events
        .get(&master)
        .ok_or_else(GraphError::item_not_found)?;
    if let Some(calendar) = calendar
        && event.calendar_id != calendar_id(calendars, calendar)?
    {
        return Err(GraphError::item_not_found());
    }
    let (organizer, uid) = (event.organizer.address.clone(), event.ical_uid.clone());
    let (_, date) = calendars.respond(id, answer, now)?;
    calendar::answer_organizer(ctx.state, &email, &organizer, &uid, date, answer, now);
    Ok(Reply::Empty(202))
}
