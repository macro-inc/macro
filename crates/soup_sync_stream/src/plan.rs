//! Plans a stream's lanes from its pass and the client's saved lane state:
//! an unfinished pass resumes from its checkpoint, a completed hydrate lane
//! catches up on changes since its watermark, and anything else starts fresh.

#[cfg(test)]
mod test;

use crate::calendar::{CalendarWindow, MaterializedRange, calendar_windows, iso_instant};
use crate::catalog::{
    CALENDAR_PAGE, CALENDAR_QUERY, LaneSpec, SoupLaneKind, SoupLaneSpec, lane_specs,
    with_updated_since,
};
use crate::lane::{
    INPUT_VARIABLE, LaneDraft, LaneError, LaneId, LaneKind, LanePlan, Paging, SOUP_CARRIED_FIELDS,
};
use crate::request::{MAX_LANES, RequestError, SavedLane, SyncRequest};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

/// What a resumable lane's page carries as `resume`, and the client sends
/// back: where the pass continues, and what it has sent so far.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Resume {
    cursor: String,
    items: u32,
    pass_started_at: DateTime<Utc>,
}

/// The `resume` of a page after which the lane continues at `cursor`.
pub(crate) fn resume_checkpoint(cursor: &str, items: u32, pass_started_at: &str) -> Value {
    json!({ "cursor": cursor, "items": items, "passStartedAt": pass_started_at })
}

/// A lane's place in the stream before calendar windows are counted.
enum Slot {
    Lane(Box<LaneDraft>),
    Calendar {
        id_prefix: &'static str,
        months: u32,
        query: Arc<str>,
    },
}

/// The stream's lanes, in load order. Calendar windows take what the lane
/// cap leaves; the farthest are dropped first and come back next run.
pub(crate) fn plan_lanes(
    request: &SyncRequest,
    now: DateTime<Utc>,
    materialized: MaterializedRange,
) -> Result<Vec<LanePlan>, RequestError> {
    let saved = request
        .lanes
        .iter()
        .map(|lane| (lane.id.as_str(), lane))
        .collect::<HashMap<_, _>>();
    let skipped = request
        .skip_lanes
        .iter()
        .map(LaneId::as_str)
        .collect::<HashSet<_>>();
    // A lane runs the client's document for its operation; one the client
    // did not send (a lane newer than the client) is left out.
    let queries = request
        .queries
        .iter()
        .map(|(operation, query)| (operation.as_str(), Arc::<str>::from(query.as_str())))
        .collect::<HashMap<_, _>>();
    let mut slots = Vec::new();
    for spec in lane_specs(request.pass) {
        match spec {
            LaneSpec::Calendar { id_prefix, months } => {
                if let (Some(_), Some(query)) =
                    (&request.calendar, queries.get(CALENDAR_QUERY.operation))
                {
                    slots.push(Slot::Calendar {
                        id_prefix,
                        months,
                        query: query.clone(),
                    });
                }
            }
            LaneSpec::Soup(spec) => {
                let Some(query) = queries.get(spec.query.operation) else {
                    continue;
                };
                let state = saved.get(spec.id).copied();
                if completed_during_run(state, request.completed_since) || skipped.contains(spec.id)
                {
                    continue;
                }
                slots.push(Slot::Lane(Box::new(soup_lane(
                    &spec,
                    query.clone(),
                    state,
                    now,
                )?)));
            }
        }
    }
    let lanes = slots
        .iter()
        .filter(|slot| matches!(slot, Slot::Lane(_)))
        .count();
    let mut budget = MAX_LANES.saturating_sub(lanes);
    let mut drafts = Vec::new();
    for slot in slots {
        match slot {
            Slot::Lane(draft) => drafts.push(*draft),
            Slot::Calendar {
                id_prefix,
                months,
                query,
            } => {
                let Some(calendar) = &request.calendar else {
                    continue;
                };
                let Ok(zone) = calendar.time_zone.parse::<Tz>() else {
                    tracing::warn!(
                        sync.time_zone = calendar.time_zone.as_str(),
                        "soup sync stream skipped calendar windows for an unknown time zone"
                    );
                    continue;
                };
                let windows =
                    calendar_windows(zone, &calendar.coverage, now, materialized, months, budget);
                budget = budget.saturating_sub(windows.len());
                for (index, window) in windows.into_iter().enumerate() {
                    drafts.push(calendar_lane(id_prefix, index, window, query.clone(), now)?);
                }
            }
        }
    }
    drafts
        .into_iter()
        .map(|draft| {
            let lane = draft.id.to_string();
            LanePlan::new(draft).map_err(|source| match source {
                // The client's document: a bad request.
                LaneError::QueryParse(_) | LaneError::OperationNotSelected(_) => {
                    RequestError::LaneQuery { lane, source }
                }
                _ => RequestError::Catalog { lane, source },
            })
        })
        .collect()
}

/// The lane completed during this run (since `since`) and has not started
/// another pass: it is current.
fn completed_during_run(state: Option<&SavedLane>, since: Option<DateTime<Utc>>) -> bool {
    let (Some(state), Some(since)) = (state, since) else {
        return false;
    };
    state.resume.is_none() && state.completed_at.is_some_and(|at| at >= since)
}

/// One Soup lane from its saved state. Membership and restart-on-run lanes
/// always start fresh.
fn soup_lane(
    spec: &SoupLaneSpec,
    query: Arc<str>,
    state: Option<&SavedLane>,
    now: DateTime<Utc>,
) -> Result<LaneDraft, RequestError> {
    let resumable = matches!(spec.kind, SoupLaneKind::Hydrate) && !spec.restart_on_run;
    let input = (spec.input)(now);
    let draft = |variables: Value, items_before: u32, pass_started_at: String| {
        Ok(LaneDraft {
            id: catalog_id(spec.id)?,
            query: query.clone(),
            operation_name: spec.query.operation,
            variables: Map::from_iter([(INPUT_VARIABLE.to_owned(), variables)]),
            paging: Paging::Soup,
            kind: match spec.kind {
                SoupLaneKind::Hydrate => LaneKind::Hydrate,
                SoupLaneKind::Membership(scopes) => LaneKind::Membership {
                    scopes: scopes
                        .iter()
                        .copied()
                        .map(catalog_id)
                        .collect::<Result<_, _>>()?,
                },
            },
            max_items: spec.max_items,
            items_before,
            resumable,
            pass_started_at,
        })
    };
    let fresh = |input: Map<String, Value>| draft(json!({ "initial": input }), 0, iso_instant(now));
    let Some(state) = state.filter(|_| resumable) else {
        return fresh(input);
    };
    if let Some(resume) = state
        .resume
        .clone()
        .and_then(|resume| serde_json::from_value::<Resume>(resume).ok())
    {
        let mut continuation = SOUP_CARRIED_FIELDS
            .iter()
            .filter_map(|field| {
                input
                    .get(*field)
                    .map(|value| ((*field).to_owned(), value.clone()))
            })
            .collect::<Map<_, _>>();
        continuation.insert("cursor".to_owned(), Value::String(resume.cursor));
        return draft(
            json!({ "continuation": continuation }),
            resume.items,
            iso_instant(resume.pass_started_at),
        );
    }
    match (state.completed_at, state.watermark) {
        (Some(_), Some(watermark)) => fresh(with_updated_since(input, watermark)),
        _ => fresh(input),
    }
}

/// One calendar window. Coverage is its checkpoint: an unfinished window is
/// fetched whole again, so its committed watermark is the lowest of every
/// page.
fn calendar_lane(
    id_prefix: &str,
    index: usize,
    window: CalendarWindow,
    query: Arc<str>,
    now: DateTime<Utc>,
) -> Result<LaneDraft, RequestError> {
    let mut input = window.input;
    input.insert("first".to_owned(), Value::from(CALENDAR_PAGE));
    Ok(LaneDraft {
        id: catalog_id(&format!("{id_prefix}-{index}"))?,
        query,
        operation_name: CALENDAR_QUERY.operation,
        variables: Map::from_iter([(INPUT_VARIABLE.to_owned(), Value::Object(input))]),
        paging: Paging::Calendar,
        kind: LaneKind::Calendar {
            coverage: window.coverage.to_vec(),
        },
        max_items: None,
        items_before: 0,
        resumable: false,
        pass_started_at: iso_instant(now),
    })
}

fn catalog_id(id: &str) -> Result<LaneId, RequestError> {
    LaneId::try_from(id.to_owned()).map_err(|_| RequestError::Catalog {
        lane: id.to_owned(),
        source: LaneError::InvalidId,
    })
}
