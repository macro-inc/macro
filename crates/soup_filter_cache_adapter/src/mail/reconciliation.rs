//! Negative membership evidence from a complete, authoritative Mail first page.
//! Invalidate contradicted projections, never infer entity deletion or a new view.

use super::*;
use item_filter_index::properties::{compile_mail, mail_profile};
use predicate_index::{IndexQuery, PredicateExpr};
use std::collections::HashMap;

/// Called only for the canonical Soup operation, after composing its current
/// projections. Backfills and cursor pages are not negative membership evidence.
/// Preparation and the eventual write run under the host's engine lock.
pub(crate) async fn first_page_updates<S: PredicateIndexStorage>(
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
        .get_batch(&[EntityKey::entity("GraphqlUser", &[viewer])])
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
        .load_optimistic_projections(&missing)
        .await
        .map_err(ProjectionError::Storage)?;
    Ok(missing
        .into_iter()
        .zip(pending)
        .filter(|(_, pending)| pending.is_none())
        .map(|(record_key, _)| ProjectionMutation::MarkIncomplete {
            record_key,
            profile: mail_profile(),
            partition: vocabulary::partition(),
            kind: ProjectionIncompleteKind::Dirty,
        })
        .collect())
}
