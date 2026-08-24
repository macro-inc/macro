use models_opensearch::SearchIndex;

use super::properties::IndexedProperty;
use crate::{Result, date_format::EpochMillis, error::OpensearchClientError};

/// The arguments for upserting a calendar event into the opensearch index.
///
/// The calendar events index is flat: one doc per **series master** (a
/// `calendar_events` row), `_id` = event id. Recurring instances are not
/// indexed — they are materialized only inside a rolling window
/// (`calendars.materialized_range`), so a per-occurrence doc would make a
/// recurring event searchable for that slice alone and would need rewriting
/// as the window rolls. Search resolves a contextual occurrence at
/// enrichment time instead.
#[derive(Debug, serde::Serialize)]
pub struct UpsertCalendarEventArgs {
    /// The id of the calendar event entity
    #[serde(rename = "entity_id")]
    pub event_id: String,
    /// The series title. Indexed as `name`: the unified search request
    /// highlights a fixed set of field names, and `name` is the one every
    /// other flat index uses for its title.
    #[serde(rename = "name")]
    pub title: String,
    /// Owner of this per-user event projection
    pub owner_id: String,
    /// The inbox link the canonical source belongs to. Delegated access is
    /// granted through this, mirroring the soup access predicate.
    pub source_link_id: String,
    /// RFC 5545 UID shared across every attendee's projection of the meeting
    pub ical_uid: String,
    /// Canonical status (`confirmed`, `tentative`, `cancelled`)
    pub status: String,
    /// Whether the series carries any recurrence rule. Lets a caller tell a
    /// recurring row from a one-off without reading the rules themselves.
    pub is_recurring: bool,
    /// Master start, in milliseconds. Absent for an all-day series.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_at_millis: Option<EpochMillis>,
    /// Master end, in milliseconds. Absent for an all-day series.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at_millis: Option<EpochMillis>,
    /// Inclusive local start date of an all-day series, as `YYYY-MM-DD`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    /// Exclusive local end date of an all-day series, as `YYYY-MM-DD`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    /// Organizer email, for the organizer filter
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organizer_email: Option<String>,
    /// Attendee emails, for the attendee filter
    pub attendee_emails: Vec<String>,
    /// The created at time of the event, in milliseconds
    pub created_at_millis: EpochMillis,
    /// The updated at time of the event, in milliseconds
    pub updated_at_millis: EpochMillis,
    /// Entity properties (tags, custom) used for search filtering.
    pub properties: Vec<IndexedProperty>,
}

/// Resolve `index_override` to the physical/alias name we'll write to.
fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::CalendarEvents.as_ref())
}

/// Upsert a single calendar event doc. Full-overwrite `index` semantics so
/// omitted optional fields (e.g. `organizer_email`) get cleared on
/// Some→None transitions.
#[tracing::instrument(skip(client, args), fields(event_id=%args.event_id), err)]
pub(crate) async fn upsert_calendar_event(
    client: &opensearch::OpenSearch,
    args: &UpsertCalendarEventArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let index = resolve_destination(index_override);
    let body = serde_json::to_value(args).map_err(|err| OpensearchClientError::Unknown {
        details: err.to_string(),
        method: Some("upsert_calendar_event".to_string()),
    })?;

    let response = client
        .index(opensearch::IndexParts::IndexId(index, &args.event_id))
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("upsert_calendar_event".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(event_id=%args.event_id, "calendar event upserted successfully");
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("upsert_calendar_event".to_string()),
            })?;

    tracing::error!(
        status_code=?status_code,
        body=?body,
        event_id=%args.event_id,
        "error upserting calendar event",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("upsert_calendar_event".to_string()),
    })
}

/// Update only the denormalized `properties` on an existing calendar event
/// doc. A missing doc (404) is a no-op — the next full upsert carries them.
pub(crate) async fn update_calendar_event_properties(
    client: &opensearch::OpenSearch,
    event_id: &str,
    properties: &[IndexedProperty],
    index_override: Option<&str>,
) -> Result<()> {
    use serde_json::json;

    let index = resolve_destination(index_override);
    let properties_value =
        serde_json::to_value(properties).map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("update_calendar_event_properties".to_string()),
        })?;
    let body = json!({ "doc": { "properties": properties_value } });

    let response = client
        .update(opensearch::UpdateParts::IndexId(index, event_id))
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_calendar_event_properties".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(event_id=%event_id, "calendar event properties updated");
        return Ok(());
    }
    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_calendar_event_properties".to_string()),
            })?;

    // A *missing document* 404 is a no-op: the doc isn't indexed yet, so the
    // next full upsert will include its properties. A *missing index* 404
    // (`index_not_found_exception`) is a real outage and must propagate.
    if status_code.as_u16() == 404 {
        let error_type = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["error"]["type"].as_str().map(str::to_owned));
        if error_type.as_deref() == Some("document_missing_exception") {
            tracing::debug!(
                event_id=%event_id,
                "calendar event not indexed yet; skipping property update"
            );
            return Ok(());
        }
    }

    tracing::error!(
        status_code=?status_code,
        body=?body,
        event_id=%event_id,
        "error updating calendar event properties",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_calendar_event_properties".to_string()),
    })
}
