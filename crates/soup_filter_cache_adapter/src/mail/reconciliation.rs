//! Negative membership evidence from a complete, authoritative Mail first page.
//! Invalidate contradicted projections, never infer entity deletion or a new view.

use super::*;
use cache_core::predicate::compose_pending_optimistic_projection;
use cache_core::queue::{MutationId, OptimisticSource, decode_optimistic_source};
use cache_core::store::DurableRead;
use item_filter_index::properties::{compile_mail, mail_profile};
use predicate_index::{
    EffectiveOptimisticProjection, IndexQuery, OptimisticProjectionState, PredicateExpr,
    evaluate_reference,
};
use std::collections::HashMap;

/// Called only for the canonical Soup operation, after composing its current
/// projections. Backfills and cursor pages are not negative membership evidence.
/// Preparation and the eventual write run under the host's engine lock.
pub(crate) async fn first_page_updates<S: DurableRead>(
    storage: &S,
    variables: &Map<String, Value>,
    data: &Value,
    incoming: &[ProjectionMutation],
) -> Result<Vec<ProjectionMutation>, ProjectionError<S::Error>> {
    let Some(initial) = variables
        .get("input")
        .and_then(|input| input.get("initial"))
    else {
        return Ok(vec![]);
    };
    // Canonical Mail order is view-specific activity time, not created/viewed time.
    if initial.get("sortMethod").and_then(Value::as_str) != Some("UPDATED_AT") {
        return Ok(vec![]);
    }
    let Some(view) = initial.get("emailView").and_then(Value::as_str) else {
        return Ok(vec![]);
    };
    let direction = match initial.get("sortDirection").and_then(Value::as_str) {
        Some("ASC") => SortDirection::Asc,
        Some("DESC") | None => SortDirection::Desc,
        _ => return Ok(vec![]),
    };
    let Some(user) = data.get("user") else {
        return Ok(vec![]);
    };
    let Some(viewer) = user.get("id").and_then(Value::as_str) else {
        return Ok(vec![]);
    };
    let Some(soup) = user.get("soup") else {
        return Ok(vec![]);
    };
    let Some(items) = soup.get("items").and_then(Value::as_array) else {
        return Ok(vec![]);
    };
    let exhausted = match soup.get("nextCursor") {
        Some(Value::Null) => true,
        Some(Value::String(_)) if !items.is_empty() => false,
        _ => return Ok(vec![]),
    };
    let Some(keys) = items
        .iter()
        .map(|item| {
            if item.get("__typename").and_then(Value::as_str) != Some(TYPE)
                || !FIELDS.iter().all(|field| item.get(*field).is_some())
            {
                return None;
            }
            let id = uuid::Uuid::parse_str(item.get("id")?.as_str()?).ok()?;
            RecordKey::new(format!("{TYPE}:{id}")).ok()
        })
        .collect::<Option<Vec<_>>>()
    else {
        return Ok(vec![]);
    };
    let records = storage
        .read_records(&[EntityKey::entity("GraphqlUser", &[viewer])])
        .await
        .map_err(ProjectionError::Storage)?;
    let Some(Some(user)) = records.first() else {
        return Ok(vec![]);
    };
    let Some(CacheValue::List(links)) = user.fields.get("emailLinks") else {
        return Ok(vec![]);
    };
    let Some(links) = links
        .iter()
        .map(|link| match link {
            CacheValue::Ref(key) => {
                uuid::Uuid::parse_str(key.as_ref().strip_prefix("GraphqlEmailLink:")?).ok()
            }
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
    else {
        return Ok(vec![]);
    };
    let Ok(ast) = materialize_graphql_filter(
        initial
            .get("filters")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new())),
    ) else {
        return Ok(vec![]);
    };
    let Ok(LocalCompileOutcome::Supported(query)) = compile_mail(
        &ast,
        SoupFlatRequest {
            sort: SoupIndexSort::UpdatedAt,
            direction,
            limit: predicate_index::MAX_QUERY_LIMIT,
            has_cursor: false,
        },
        view,
        &links,
        viewer,
    ) else {
        return Ok(vec![]);
    };
    let documents: HashMap<_, _> = incoming
        .iter()
        .filter_map(|mutation| match mutation {
            ProjectionMutation::Replace(document) if document.profile == mail_profile() => {
                Some((&document.record_key, document))
            }
            _ => None,
        })
        .collect();
    // Every server row must have complete canonical facts. A partial response
    // cannot establish a safe boundary, even when nextCursor happens to be null.
    let Some(positions) = keys
        .iter()
        .map(|key| {
            let document = documents.get(key)?;
            let value = document
                .sort_facts
                .iter()
                .find(|fact| fact.attribute == query.as_query().sort_attribute)?
                .value;
            Some((value, key))
        })
        .collect::<Option<Vec<_>>>()
    else {
        return Ok(vec![]);
    };
    if positions
        .windows(2)
        .any(|pair| !query.sorts_after(pair[1], pair[0]))
    {
        return Ok(vec![]);
    }
    let mut bounded: IndexQuery = query.as_query().clone();
    if !exhausted && let Some((value, key)) = positions.last() {
        for partition in &mut bounded.partitions {
            partition.predicate = PredicateExpr::And(
                Box::new(partition.predicate.clone()),
                Box::new(PredicateExpr::Not(Box::new(PredicateExpr::After {
                    attribute: bounded.sort_attribute.clone(),
                    value: *value,
                    key: (*key).clone(),
                    direction: bounded.sort_direction,
                    tie_direction: bounded.tie_break_direction,
                }))),
            );
        }
    }
    let bounded = ValidatedIndexQuery::new(bounded).map_err(error)?;
    // Bound each authoritative write's work to one index page. A severely stale
    // cache converges over subsequent refreshes rather than scanning the mailbox.
    let local = storage
        .storage()
        .reconcile_predicate_index(&bounded, &[])
        .await
        .map_err(ProjectionError::Storage)?;
    let returned: HashSet<_> = keys.into_iter().collect();
    let missing: Vec<_> = local
        .keys
        .into_iter()
        .filter(|key| !returned.contains(key))
        .collect();
    let pending = storage
        .storage()
        .load_optimistic_projections(&missing)
        .await
        .map_err(ProjectionError::Storage)?;
    let protected: Vec<_> = missing
        .iter()
        .zip(&pending)
        .filter_map(|(key, pending)| Some((key, pending.as_ref()?)))
        .collect();
    let contradicted = contradicted_writes(storage, &bounded, &protected).await?;
    Ok(missing
        .into_iter()
        .zip(pending)
        .filter(|(key, pending)| pending.is_none() || contradicted.contains(key))
        .map(|(record_key, _)| ProjectionMutation::MarkIncomplete {
            record_key,
            profile: mail_profile(),
            partition: vocabulary::partition(),
            kind: ProjectionIncompleteKind::Dirty,
        })
        .collect())
}

/// Rows with queued writes that the page still contradicts.
///
/// The server may have applied any prefix of the queue: none of it, the
/// first write, the first two, and so on. A row the page left out is
/// contradicted only when its stored facts and every one of those prefixes
/// still place it in the window: then no queued write explains the omission,
/// and the server knows something the cache does not (a thread trashed
/// through REST while its mark read is queued). An archive whose Undo is
/// still queued explains it, so that row keeps its pending membership.
async fn contradicted_writes<S: DurableRead>(
    storage: &S,
    bounded: &ValidatedIndexQuery,
    protected: &[(&RecordKey, &EffectiveOptimisticProjection)],
) -> Result<HashSet<RecordKey>, ProjectionError<S::Error>> {
    if protected.is_empty() {
        return Ok(HashSet::new());
    }
    let keys: Vec<_> = protected.iter().map(|(key, _)| (*key).clone()).collect();
    let stored = storage
        .read_projection_states(&keys)
        .await
        .map_err(ProjectionError::Storage)?;
    // Most queued writes are on rows whose stored facts already leave the
    // window; read the queue only when one does not.
    let stored_in_window: Vec<_> = protected
        .iter()
        .zip(stored)
        .filter_map(|((key, shadow), state)| match state {
            Some(ProjectionState::Complete(document)) if in_window(bounded, &document) => {
                Some((*key, *shadow, ProjectionState::Complete(document)))
            }
            _ => None,
        })
        .collect();
    if stored_in_window.is_empty() {
        return Ok(HashSet::new());
    }
    let queue = storage
        .read_mutation_queue()
        .await
        .map_err(ProjectionError::Storage)?;
    let Ok(sources) = queue
        .iter()
        .map(|row| {
            decode_optimistic_source(&row.optimistic.optimistic_data_json)
                .map(|source| (row.id, source))
        })
        .collect::<Result<Vec<_>, _>>()
    else {
        return Ok(HashSet::new());
    };
    Ok(stored_in_window
        .into_iter()
        .filter(|(key, shadow, stored)| {
            every_prefix_in_window(bounded, key, stored, shadow, &sources)
        })
        .map(|(key, ..)| key.clone())
        .collect())
}

/// Replays the queue over the stored facts, as storage composes the shadow.
/// Storage builds the shadow from the same writes, so the replay ends at it;
/// if it does not, the replay proves nothing and the row keeps its protection.
fn every_prefix_in_window(
    bounded: &ValidatedIndexQuery,
    key: &RecordKey,
    stored: &ProjectionState,
    shadow: &EffectiveOptimisticProjection,
    sources: &[(MutationId, OptimisticSource)],
) -> bool {
    let mut current: Option<EffectiveOptimisticProjection> = None;

    // Composing copies and validates the row's state, so skip the writes
    // that leave this row alone before composing.
    let touching = sources.iter().filter(|(_, source)| {
        source
            .projection_mutations
            .iter()
            .any(|mutation| mutation.record_key() == key)
    });
    for (owner, source) in touching {
        let Ok(next) = compose_pending_optimistic_projection(
            key,
            Some(stored),
            current.as_ref(),
            &source.projection_mutations,
        ) else {
            return false;
        };
        let Some(next) = next else { continue };
        let listed = match &next.state {
            OptimisticProjectionState::Complete(document) => {
                next.uncertainty.is_empty() && in_window(bounded, document)
            }
            _ => false,
        };
        if !listed {
            return false;
        }
        current = Some(EffectiveOptimisticProjection {
            owner: *owner,
            state: next.state,
            uncertainty: next.uncertainty,
        });
    }
    current.is_some_and(|replayed| {
        replayed.state == shadow.state && replayed.uncertainty == shadow.uncertainty
    })
}

fn in_window(bounded: &ValidatedIndexQuery, document: &IndexDocument) -> bool {
    !evaluate_reference(bounded, std::slice::from_ref(document)).is_empty()
}
