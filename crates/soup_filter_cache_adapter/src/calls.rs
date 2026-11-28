//! Viewer-scoped call membership from complete GraphQL snapshots.

use super::*;
use crate::mail::ProjectionError;
use cache_core::predicate::PredicateIndexStorage;
use cache_core::store::DurableRead;
use item_filter_index::calls as facts;
use predicate_index::{ExactFact, IntegerFact, PredicateExpr, utc_timestamp_micros};
use serde_json::{Map, Value};
use uuid::Uuid;

pub(super) const TYPE: &str = "GraphqlSoupCall";
pub(super) const INPUTS: &[&str] = &["id", "channelId", "status", "startedAt", "endedAt"];

pub(super) fn project(
    object: &Map<String, Value>,
    fields: &[&FieldNode],
) -> Option<ProjectionMutation> {
    let selected_fields: Vec<_> = fields
        .iter()
        .copied()
        .filter(|field| INPUTS.contains(&field.name.as_str()))
        .collect();
    if !selected_fields.iter().any(|field| field.name != "id") {
        // Previews that select only names and identity say nothing about list membership.
        return None;
    }

    let id_field = selected_fields.iter().find(|field| field.name == "id")?;
    let id = Uuid::parse_str(object.get(&id_field.response_key)?.as_str()?).ok()?;
    let key = RecordKey::new(format!("{TYPE}:{id}")).ok()?;
    let document = direct_patch::selected_object(object, &selected_fields)
        .ok()
        .and_then(|object| complete(key.clone(), id, &object));
    Some(document.map_or_else(
        || ProjectionMutation::MarkIncomplete {
            record_key: key,
            profile: vocabulary::profile_v6(),
            partition: facts::partition(),
            kind: ProjectionIncompleteKind::Missing,
        },
        ProjectionMutation::Replace,
    ))
}

fn complete(key: RecordKey, id: Uuid, object: &Map<String, Value>) -> Option<IndexDocument> {
    let started = graphql_timestamp(object.get("startedAt")?)?;
    let ended = match object.get("endedAt")? {
        Value::Null => started,
        value => graphql_timestamp(value)?,
    };
    let status = object.get("status")?.as_str()?;
    if !matches!(status, "ATTENDED" | "MISSED" | "UNATTENDED") {
        return None;
    }
    let mut exact_facts = vec![
        ExactFact {
            attribute: vocabulary::id(),
            value: ExactValue::new(id.as_bytes()).ok()?,
        },
        ExactFact {
            attribute: facts::status(),
            value: ExactValue::utf8(status).ok()?,
        },
    ];
    if let Some(channel) = optional_uuid(object.get("channelId")?)? {
        exact_facts.push(ExactFact {
            attribute: facts::channel_id(),
            value: ExactValue::new(channel.as_bytes()).ok()?,
        });
    }

    let mut document = IndexDocument {
        record_key: key,
        profile: vocabulary::profile_v6(),
        partition: facts::partition(),
        exact_facts,
        integer_facts: vec![],
        sort_facts: vec![
            IntegerFact {
                attribute: vocabulary::created_at(),
                value: utc_timestamp_micros(started),
            },
            IntegerFact {
                attribute: vocabulary::updated_at(),
                value: utc_timestamp_micros(ended),
            },
        ],
    };
    document.canonicalize();
    Some(document)
}

/// An authoritative first page can contradict facts from before a missed
/// push. Repair only its proven sort window, leaving the record itself intact.
pub(super) async fn first_page_updates<S: DurableRead>(
    storage: &S,
    variables: &Map<String, Value>,
    data: &Value,
    incoming: &[ProjectionMutation],
) -> Result<Vec<ProjectionMutation>, ProjectionError<S::Error>> {
    let Some(initial) = variables
        .get("input")
        .and_then(|input| input.get("initial"))
    else {
        return Ok(Vec::new());
    };
    // An unexpanded or zero-row request cannot prove a call is absent.
    if initial.get("expand").and_then(Value::as_bool) == Some(false)
        || initial.get("limit").and_then(Value::as_u64) == Some(0)
    {
        return Ok(Vec::new());
    }
    let Some(page) = data.get("user").and_then(|user| user.get("soup")) else {
        return Ok(Vec::new());
    };
    let Some(items) = page.get("items").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let exhausted = match page.get("nextCursor") {
        Some(Value::Null) => true,
        Some(Value::String(_)) if !items.is_empty() => false,
        _ => return Ok(Vec::new()),
    };
    if items
        .iter()
        .any(|item| item.get("__typename").and_then(Value::as_str) != Some(TYPE))
        || !matches!(
            initial.get("sortDirection").and_then(Value::as_str),
            None | Some("DESC")
        )
    {
        return Ok(Vec::new());
    }
    let sort = match initial.get("sortMethod").and_then(Value::as_str) {
        Some("CREATED_AT") => SoupIndexSort::CreatedAt,
        Some("UPDATED_AT") => SoupIndexSort::UpdatedAt,
        _ => return Ok(Vec::new()),
    };
    let Some(filters) = initial.get("filters") else {
        return Ok(Vec::new());
    };
    let Ok(ast) = materialize_graphql_filter(filters.clone()) else {
        return Ok(Vec::new());
    };
    let Ok(LocalCompileOutcome::Supported(query)) = facts::compile_call_list(
        &ast,
        SoupFlatRequest {
            sort,
            direction: SortDirection::Desc,
            limit: predicate_index::MAX_QUERY_LIMIT,
            has_cursor: false,
        },
    ) else {
        return Ok(Vec::new());
    };

    let documents: std::collections::HashMap<_, _> = incoming
        .iter()
        .filter_map(|mutation| {
            let ProjectionMutation::Replace(document) = mutation else {
                return None;
            };
            (document.partition == facts::partition())
                .then_some((document.record_key.as_str(), document))
        })
        .collect();
    let Some(positions) = items
        .iter()
        .map(|item| {
            let key = format!("{TYPE}:{}", item.get("id")?.as_str()?);
            let document = documents.get(key.as_str())?;
            let value = document
                .sort_facts
                .iter()
                .find(|fact| fact.attribute == query.as_query().sort_attribute)?
                .value;
            Some((value, &document.record_key))
        })
        .collect::<Option<Vec<_>>>()
    else {
        return Ok(Vec::new());
    };
    if positions
        .windows(2)
        .any(|pair| !query.sorts_after(pair[1], pair[0]))
    {
        return Ok(Vec::new());
    }

    let mut window = query.as_query().clone();
    if !exhausted && let Some((value, key)) = positions.last() {
        let partition = &mut window.partitions[0];
        partition.predicate = PredicateExpr::And(
            Box::new(partition.predicate.clone()),
            Box::new(PredicateExpr::Not(Box::new(PredicateExpr::After {
                attribute: window.sort_attribute.clone(),
                value: *value,
                key: (*key).clone(),
                direction: window.sort_direction,
                tie_direction: window.tie_break_direction,
            }))),
        );
    }
    let window = ValidatedIndexQuery::new(window)
        .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?;
    let local = storage
        .storage()
        .reconcile_predicate_index(&window, &[])
        .await
        .map_err(ProjectionError::Storage)?;
    if local.optimistic {
        return Ok(Vec::new());
    }
    let returned: HashSet<_> = positions.into_iter().map(|(_, key)| key).collect();
    Ok(local
        .keys
        .into_iter()
        .filter(|key| !returned.contains(key))
        .map(|record_key| ProjectionMutation::MarkIncomplete {
            record_key,
            profile: vocabulary::profile_v6(),
            partition: facts::partition(),
            kind: ProjectionIncompleteKind::Dirty,
        })
        .collect())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
