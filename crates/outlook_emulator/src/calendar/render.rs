//! Graph's JSON for calendars, events and the occurrences of a series.

use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};

use super::time::{graph_time, stamp};
use super::{Calendar, Calendars, Event, Occurrence, Response, change_key, find_property};
use crate::error::GraphError;
use crate::mailbox::Address;
use crate::odata::{self, Query};

const PREVIEW_LENGTH: usize = 255;
const EVENT_TYPE: &str = "Microsoft.OutlookServices.Event";
/// Properties Graph answers only when `$select` names them.
const SELECT_ONLY: [&str; 2] = ["cancelledOccurrences", "exceptionOccurrences"];
/// Left out of a listing's default properties as well, although Graph's
/// documentation lists it.
const ORIGINAL_START: &str = "originalStart";

/// Whether an event is answered by itself or as one of a collection.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Listing {
    One,
    Many,
}

pub(crate) fn calendar_resource(calendar: &Calendar, owner: &Address) -> Value {
    json!({
        "id": calendar.id,
        "name": calendar.name,
        "color": calendar.color,
        "hexColor": calendar.hex_color,
        "isDefaultCalendar": calendar.is_default,
        "changeKey": change_key(1),
        "canShare": calendar.can_edit,
        "canViewPrivateItems": calendar.can_edit,
        "canEdit": calendar.can_edit,
        "allowedOnlineMeetingProviders": calendar.online_meeting_providers,
        "defaultOnlineMeetingProvider": calendar
            .online_meeting_providers
            .first()
            .map_or("unknown", String::as_str),
        "isTallyingResponses": calendar.is_default,
        "isRemovable": !calendar.is_default,
        "owner": {"name": owner.name.as_deref().unwrap_or(&owner.address), "address": owner.address},
    })
}

fn preview(fields: &Map<String, Value>) -> String {
    let content = fields
        .get("body")
        .and_then(|body| body["content"].as_str())
        .unwrap_or_default();
    let mut text = String::new();
    let mut in_tag = false;
    for character in content.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            other if !in_tag => text.push(other),
            _ => {}
        }
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    words.join(" ").chars().take(PREVIEW_LENGTH).collect()
}

fn response_status(response: &Response) -> Value {
    json!({
        "response": response.response,
        "time": response.time.map_or_else(|| "0001-01-01T00:00:00Z".to_string(), stamp),
    })
}

/// What differs between an event, a series and one of its occurrences.
struct Shape<'a> {
    id: String,
    kind: &'static str,
    series_master_id: Option<&'a str>,
    occurrence_id: Option<String>,
    original_start: Option<DateTime<Utc>>,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    version: u64,
    modified: DateTime<Utc>,
    response: &'a Response,
}

fn resource(
    event: &Event,
    fields: &Map<String, Value>,
    owner: &Address,
    shape: Shape<'_>,
) -> Value {
    let field = |key: &str| fields.get(key).cloned().unwrap_or(Value::Null);
    let cancelled: Vec<String> = event
        .cancelled
        .keys()
        .map(|date| format!("OID.{}.{date}", event.id))
        .collect();
    let mut resource = json!({
        "@odata.etag": format!("W/\"{}\"", change_key(shape.version)),
        "id": shape.id,
        "createdDateTime": stamp(event.created),
        "lastModifiedDateTime": stamp(shape.modified),
        "changeKey": change_key(shape.version),
        "categories": field("categories"),
        "transactionId": field("transactionId"),
        "originalStartTimeZone": field("originalStartTimeZone"),
        "originalEndTimeZone": field("originalEndTimeZone"),
        "iCalUId": event.ical_uid,
        "reminderMinutesBeforeStart": field("reminderMinutesBeforeStart"),
        "isReminderOn": field("isReminderOn"),
        "hasAttachments": field("hasAttachments"),
        "subject": field("subject"),
        "bodyPreview": preview(fields),
        "importance": field("importance"),
        "sensitivity": field("sensitivity"),
    });
    // In two halves: one literal this long passes `json!`'s recursion limit.
    let rest = json!({
        "isAllDay": field("isAllDay"),
        "isCancelled": field("isCancelled"),
        "isOrganizer": event.organizer.address.eq_ignore_ascii_case(&owner.address),
        "responseRequested": field("responseRequested"),
        "seriesMasterId": shape.series_master_id,
        "showAs": field("showAs"),
        "type": shape.kind,
        "webLink": format!(
            "https://outlook.office365.com/owa/?itemid={}&exvsurl=1&path=/calendar/item",
            shape.id
        ),
        "onlineMeetingUrl": field("onlineMeetingUrl"),
        "isOnlineMeeting": field("isOnlineMeeting"),
        "onlineMeetingProvider": field("onlineMeetingProvider"),
        "allowNewTimeProposals": field("allowNewTimeProposals"),
        "occurrenceId": shape.occurrence_id,
        "isDraft": false,
        "hideAttendees": field("hideAttendees"),
        "responseStatus": response_status(shape.response),
        "body": field("body"),
        "start": graph_time(shape.start),
        "end": graph_time(shape.end),
        "location": field("location"),
        "locations": field("locations"),
        "recurrence": match shape.series_master_id {
            Some(_) => Value::Null,
            None => field("recurrence"),
        },
        "attendees": field("attendees"),
        "organizer": event.organizer.json(),
        "onlineMeeting": field("onlineMeeting"),
        "originalStart": shape.original_start.map(stamp),
        "cancelledOccurrences": match shape.series_master_id {
            Some(_) => Vec::new(),
            None => cancelled,
        },
    });
    if let (Some(resource), Value::Object(rest)) = (resource.as_object_mut(), rest) {
        resource.extend(rest);
    }
    resource
}

/// Applies `$select` and `$expand`, as Graph does for an event.
fn finish(
    mut resource: Value,
    query: &Query,
    listing: Listing,
    property: impl Fn(&str) -> Option<String>,
) -> Result<Value, GraphError> {
    let selected = |name: &str| {
        query
            .select
            .as_ref()
            .is_some_and(|names| names.iter().any(|selected| selected == name))
    };
    if let Some(object) = resource.as_object_mut() {
        for name in SELECT_ONLY {
            let expanded = name == "exceptionOccurrences" && query.exceptions.is_some();
            if !selected(name) && !expanded {
                object.remove(name);
            }
        }
        if listing == Listing::Many && query.select.is_none() {
            object.remove(ORIGINAL_START);
        }
    }
    let mut resource = odata::select(resource, query.select.as_deref(), EVENT_TYPE)?;
    let properties: Vec<Value> = query
        .properties
        .iter()
        .filter_map(|id| Some(json!({"id": id, "value": property(id)?})))
        .collect();
    if !properties.is_empty() {
        resource["singleValueExtendedProperties"] = Value::Array(properties);
    }
    Ok(resource)
}

/// A single event or a series master.
pub(crate) fn event_resource(
    event: &Event,
    calendars: &Calendars,
    query: &Query,
    listing: Listing,
) -> Result<Value, GraphError> {
    let unreadable = || {
        GraphError::server(
            500,
            "ErrorInternalServerError",
            "The event has no readable time.",
        )
    };
    let (start, end) = (
        event.start().ok_or_else(unreadable)?,
        event.end().ok_or_else(unreadable)?,
    );
    let shape = Shape {
        id: event.id.clone(),
        kind: if event.is_series() {
            "seriesMaster"
        } else {
            "singleInstance"
        },
        series_master_id: None,
        occurrence_id: None,
        original_start: None,
        start: start.instant(),
        end: end.instant(),
        version: event.version,
        modified: event.modified,
        response: &event.response,
    };
    let mut resource = resource(event, &event.fields, &calendars.owner, shape);
    for (key, value) in &event.raw {
        resource[key.as_str()] = value.clone();
    }

    // `$expand=exceptionOccurrences($select=…)`: the changed occurrences.
    if let Some(select) = &query.exceptions {
        let inner = Query {
            select: Some(select.clone()),
            ..Query::default()
        };
        let mut exceptions = Vec::new();
        for date in event.exceptions.keys() {
            if let Some(occurrence) = event.occurrence(*date) {
                exceptions.push(occurrence_resource(
                    &occurrence,
                    calendars,
                    &inner,
                    Listing::One,
                )?);
            }
        }
        resource["exceptionOccurrences"] = Value::Array(exceptions);
    }
    finish(resource, query, listing, |id| event.property(id))
}

/// One occurrence of a series: an `occurrence`, or an `exception` when
/// someone changed it.
pub(crate) fn occurrence_resource(
    occurrence: &Occurrence<'_>,
    calendars: &Calendars,
    query: &Query,
    listing: Listing,
) -> Result<Value, GraphError> {
    let master = occurrence.master;
    let mut fields = master.fields.clone();
    if let Some(exception) = occurrence.exception {
        fields.extend(exception.overrides.clone());
    }
    let exception = occurrence.exception;
    let shape = Shape {
        id: occurrence.id(),
        kind: if exception.is_some() {
            "exception"
        } else {
            "occurrence"
        },
        series_master_id: Some(&master.id),
        occurrence_id: Some(format!("OID.{}.{}", master.id, occurrence.date)),
        original_start: Some(occurrence.original_start),
        start: occurrence.start,
        end: occurrence.end,
        version: master.version + exception.map_or(0, |exception| exception.version),
        modified: exception
            .and_then(|exception| exception.modified)
            .unwrap_or(master.modified),
        response: exception
            .and_then(|exception| exception.response.as_ref())
            .unwrap_or(&master.response),
    };
    let resource = resource(master, &fields, &calendars.owner, shape);
    // An unchanged occurrence answers the series' extended properties; an
    // exception only its own, besides the sequence.
    finish(resource, query, listing, |id| match exception {
        Some(exception) => find_property(&exception.properties, id).or_else(|| {
            id.eq_ignore_ascii_case(super::SEQUENCE_PROPERTY)
                .then(|| master.sequence.to_string())
        }),
        None => master.property(id),
    })
}
