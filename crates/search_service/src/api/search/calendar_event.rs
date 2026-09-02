use crate::api::search::simple::SearchError;
use indexmap::IndexMap;
use macro_db_client::calendar_event::get_events_for_search::{
    CalendarEventSearchInfo, get_calendar_events_for_search,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::{EntityReference, EntityType};
use models_search::calendar_event::{
    CalendarEventMetadata, CalendarEventOrganizer, CalendarEventSearchOccurrence,
    CalendarEventSearchResponseItem, CalendarEventSearchResponseItemWithMetadata,
    CalendarEventSearchResult, CalendarEventSearchTime,
};
use models_soup::SoupProperty;
use sqlx::types::Uuid;
use std::collections::HashMap;
use system_properties::SystemPropertyKey;

use crate::api::context::SearchHandlerState;

/// Enriches calendar event search results with metadata and the instance each
/// row points at.
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_calendar_events(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<CalendarEventSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::CalendarEvents)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }

    let event_ids: Vec<Uuid> = results.iter().map(|r| r.entity_id).collect();

    // Re-reads visibility from Postgres rather than trusting the index: an
    // event the caller lost access to since it was indexed is absent here and
    // its hit is dropped below.
    let events = get_calendar_events_for_search(&ctx.db, user_id, &event_ids, chrono::Utc::now())
        .await
        .map_err(SearchError::InternalError)?;

    // Fetch event properties (e.g. tags) so rows can render and re-check
    // them, mirroring the projects enrichment.
    let entity_refs: Vec<EntityReference> = event_ids
        .iter()
        .map(|id| EntityReference::new(id.to_string(), EntityType::CalendarEvent))
        .collect();
    // Scope tags to the viewer so another user's personal tags never leak into
    // the response. System properties still ride along via the key list.
    let viewer_user_id = MacroUserIdStr::parse_from_str(user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_string()))?;
    let properties_map: HashMap<String, Vec<SoupProperty>> =
        properties::outbound::entity_properties_get_query::get_bulk_entity_properties_values_filtered(
            &ctx.db,
            &entity_refs,
            SystemPropertyKey::all_system_property_keys(),
            Some(&viewer_user_id),
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to fetch calendar event properties"))
        .unwrap_or_default()
        .into_iter()
        .map(|(id, props)| {
            (
                id,
                props
                    .into_iter()
                    .map(SoupProperty::from)
                    .collect::<Vec<_>>(),
            )
        })
        .collect();

    Ok(construct_search_result(results, events, properties_map))
}

/// Read a timed or all-day span out of the four nullable columns the
/// `calendar_events` time-shape constraint keeps mutually exclusive.
fn to_search_time(
    starts_at: Option<chrono::DateTime<chrono::Utc>>,
    ends_at: Option<chrono::DateTime<chrono::Utc>>,
    start_date: Option<chrono::NaiveDate>,
    end_date: Option<chrono::NaiveDate>,
    time_zone: Option<String>,
) -> Option<CalendarEventSearchTime> {
    match (starts_at, ends_at, start_date, end_date) {
        (Some(starts_at), Some(ends_at), None, None) => Some(CalendarEventSearchTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        }),
        (None, None, Some(start_date), Some(end_date)) => Some(CalendarEventSearchTime::AllDay {
            start_date,
            end_date,
        }),
        _ => None,
    }
}

/// Build the resolved-occurrence payload, if the lateral found one and its
/// span reads cleanly.
fn to_occurrence(info: &CalendarEventSearchInfo) -> Option<CalendarEventSearchOccurrence> {
    let occurrence_key = info.occurrence_key.clone()?;
    let time = to_search_time(
        info.occurrence_starts_at,
        info.occurrence_ends_at,
        info.occurrence_start_date,
        info.occurrence_end_date,
        info.time_zone.clone(),
    )?;
    Some(CalendarEventSearchOccurrence {
        occurrence_key,
        time,
    })
}

/// Build the organizer payload when the source named a name or an email.
fn to_organizer(info: &CalendarEventSearchInfo) -> Option<CalendarEventOrganizer> {
    if info.organizer_name.is_none() && info.organizer_email.is_none() {
        return None;
    }
    Some(CalendarEventOrganizer {
        name: info.organizer_name.clone(),
        email: info.organizer_email.clone(),
    })
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    events: HashMap<Uuid, CalendarEventSearchInfo>,
    mut properties_map: HashMap<String, Vec<SoupProperty>>,
) -> Vec<CalendarEventSearchResponseItemWithMetadata> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve
    // insertion order
    let entity_id_hit_map: IndexMap<Uuid, Vec<CalendarEventSearchResult>> = search_results
        .into_iter()
        .map(|hit| {
            let result = CalendarEventSearchResult {
                highlight: hit.highlight.into(),
                score: hit.score,
            };
            (hit.entity_id, result)
        })
        .fold(IndexMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            let info = events.get(&entity_id)?;
            // An event whose stored span satisfies neither leg of the
            // time-shape constraint cannot be rendered on a calendar row, so
            // it is dropped rather than surfaced without a date.
            let time = to_search_time(
                info.starts_at,
                info.ends_at,
                info.start_date,
                info.end_date,
                info.time_zone.clone(),
            )?;
            Some(CalendarEventSearchResponseItemWithMetadata {
                metadata: Some(CalendarEventMetadata {
                    created_at: info.created_at,
                    updated_at: info.updated_at,
                    status: info.status.clone(),
                    time,
                    is_recurring: info.is_recurring,
                    occurrence: to_occurrence(info),
                    conference_url: info.conference_url.clone(),
                    is_read_only: info.is_read_only,
                    organizer: to_organizer(info),
                    description: info.description.clone(),
                }),
                properties: properties_map
                    .remove(&entity_id.to_string())
                    .filter(|p| !p.is_empty()),
                extra: CalendarEventSearchResponseItem {
                    id: entity_id,
                    name: info.title.clone(),
                    owner_id: info.owner_id.clone(),
                    updated_at: info.updated_at,
                    created_at: info.created_at,
                    calendar_event_search_results: hits,
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod test;
