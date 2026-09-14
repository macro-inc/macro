//! Notification contributions derived from GraphQL state, never viewing timestamps.

use super::*;
use cache_core::{
    normalize::normalize,
    predicate::ProjectionState,
    store::Storage,
    value::{CacheValue, EntityKey, Record},
};
use predicate_index::ExactFact;

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

/// Resolve edge and child aliases from the actual selection, not arbitrary payload fields.
pub(super) fn selected_snapshot(
    object: &serde_json::Map<String, serde_json::Value>,
    fields: &[&FieldNode],
) -> Option<serde_json::Value> {
    let mut selected = None;
    for field in fields.iter().filter(|field| field.name == "notifications") {
        let value = match object
            .get(&field.response_key)
            .and_then(serde_json::Value::as_array)
        {
            Some(values) => {
                let mut child_fields = Vec::new();
                collect_applicable_fields(
                    &field.selection_set,
                    "GraphqlNotification",
                    &mut child_fields,
                );
                serde_json::Value::Array(
                    values
                        .iter()
                        .map(|value| {
                            let Some(object) = value.as_object() else {
                                return serde_json::Value::Null;
                            };
                            let mut canonical = serde_json::Map::new();
                            for field in &child_fields {
                                if let Some(value) = object.get(&field.response_key)
                                    && canonical
                                        .insert(field.name.clone(), value.clone())
                                        .is_some_and(|old| old != *value)
                                {
                                    return serde_json::Value::Null;
                                }
                            }
                            serde_json::Value::Object(canonical)
                        })
                        .collect(),
                )
            }
            None => serde_json::Value::Null,
        };
        if selected.as_ref().is_some_and(|previous| previous != &value) {
            return Some(serde_json::Value::Null);
        }
        selected = Some(value);
    }
    selected
}

/// Complete active-edge snapshot. Empty is authoritative; omitted or malformed is unknown.
pub(super) fn compose_active_notifications(
    mut document: IndexDocument,
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<IndexDocument, ()> {
    document
        .exact_facts
        .extend(snapshot_facts(&document.record_key, object)?);
    document.profile = vocabulary::profile_v4();
    document.canonicalize();
    soup_filter_projection::validate_soup_flat_v4(&document).map_err(|_| ())?;
    Ok(document)
}

pub(super) fn snapshot_patches(
    key: &RecordKey,
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<Vec<ExactAttributePatch>, ()> {
    let facts = snapshot_facts(key, object)?;
    Ok([
        vocabulary::notification_unseen(),
        vocabulary::notification_seen(),
    ]
    .into_iter()
    .map(|attribute| ExactAttributePatch {
        values: facts
            .iter()
            .filter(|fact| fact.attribute == attribute)
            .map(|fact| fact.value.clone())
            .collect(),
        attribute,
    })
    .collect())
}

fn snapshot_facts(
    key: &RecordKey,
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<Vec<ExactFact>, ()> {
    let notifications = object
        .get("notifications")
        .and_then(serde_json::Value::as_array)
        .ok_or(())?;
    let (typename, id) = key.as_str().split_once(':').ok_or(())?;
    let entity_type = match typename {
        "GraphqlSoupDocument" => "DOCUMENT",
        "GraphqlSoupProject" => "PROJECT",
        "GraphqlSoupChat" => "CHAT",
        _ => return Err(()),
    };
    let mut states = std::collections::BTreeMap::new();
    for notification in notifications {
        let notification = notification.as_object().ok_or(())?;
        // The display edge also contains secondary-entity matches; Soup's SQL
        // predicate for these three partitions only uses primary association.
        let primary_id = notification
            .get("entityId")
            .and_then(serde_json::Value::as_str)
            .ok_or(())?;
        let primary_type = notification
            .get("entityType")
            .and_then(serde_json::Value::as_str)
            .ok_or(())?;
        if primary_id != id || primary_type != entity_type {
            continue;
        }
        let notification_id = uuid::Uuid::parse_str(
            notification
                .get("id")
                .and_then(serde_json::Value::as_str)
                .ok_or(())?,
        )
        .map_err(|_| ())?;
        let state = notification
            .get("state")
            .and_then(serde_json::Value::as_str)
            .ok_or(())?;
        if !matches!(state, "UNSEEN" | "SEEN" | "DONE") {
            return Err(());
        }
        if states
            .insert(notification_id, state)
            .is_some_and(|previous| previous != state)
        {
            return Err(());
        }
    }
    let mut facts = Vec::new();
    for (id, state) in states {
        if let Some(attribute) = state_attribute(state)? {
            facts.push(member(attribute, id));
        }
    }
    Ok(facts)
}

fn state_attribute(state: &str) -> Result<Option<Token>, ()> {
    match state {
        "UNSEEN" => Ok(Some(vocabulary::notification_unseen())),
        "SEEN" => Ok(Some(vocabulary::notification_seen())),
        "DONE" => Ok(None),
        _ => Err(()),
    }
}

fn member(attribute: Token, id: uuid::Uuid) -> ExactFact {
    ExactFact {
        attribute,
        value: ExactValue::new(id.as_bytes()).expect("UUID is bounded"),
    }
}

fn association(record: &Record) -> Option<(RecordKey, Token)> {
    let CacheValue::String(id) = record.fields.get("entityId")? else {
        return None;
    };
    let CacheValue::String(kind) = record.fields.get("entityType")? else {
        return None;
    };
    let typename = match kind.as_str() {
        "DOCUMENT" => "GraphqlSoupDocument",
        "PROJECT" => "GraphqlSoupProject",
        "CHAT" => "GraphqlSoupChat",
        _ => return None,
    };
    uuid::Uuid::parse_str(id).ok()?;
    Some((
        RecordKey::new(format!("{typename}:{id}")).ok()?,
        projection_partition(typename)?,
    ))
}

fn change(
    record_key: RecordKey,
    partition: Token,
    id: uuid::Uuid,
    state: Option<&str>,
) -> ProjectionMutation {
    let remove = vec![
        member(vocabulary::notification_unseen(), id),
        member(vocabulary::notification_seen(), id),
    ];
    let attribute = state.map(state_attribute).transpose();
    match attribute {
        Ok(attribute) => ProjectionMutation::PatchExact {
            record_key,
            partition,
            profile: vocabulary::profile_v4(),
            remove,
            insert: attribute
                .flatten()
                .map(|attribute| member(attribute, id))
                .into_iter()
                .collect(),
        },
        Err(()) => ProjectionMutation::MarkIncomplete {
            record_key,
            partition,
            profile: vocabulary::profile_v4(),
            kind: ProjectionIncompleteKind::Dirty,
        },
    }
}

/// Notification identity alone does not establish the parent's projection coverage.
/// Inbox rows and secondary edges can refer to parents outside the hydrated set;
/// emitting a patch or invalidation for them would introduce an incomplete marker
/// and force unrelated local lists to fall back. Full snapshots establish coverage
/// independently, including when they arrive in the same write as these rows.
async fn retain_complete_parents<S: Storage>(
    storage: &S,
    mutations: Vec<ProjectionMutation>,
) -> Result<Vec<ProjectionMutation>, SoupFilterCacheAdapterError> {
    if mutations.is_empty() {
        return Ok(mutations);
    }
    let keys = mutations
        .iter()
        .map(|mutation| mutation.record_key().clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let states = storage
        .load_projection_states(&keys)
        .await
        .map_err(|e| SoupFilterCacheAdapterError(e.to_string()))?;
    let states = keys.into_iter().zip(states).collect::<IndexMap<_, _>>();
    Ok(mutations
        .into_iter()
        .filter(|mutation| {
            let (ProjectionMutation::PatchExact {
                record_key,
                profile,
                partition,
                ..
            }
            | ProjectionMutation::MarkIncomplete {
                record_key,
                profile,
                partition,
                ..
            }) = mutation
            else {
                unreachable!("notification updates are member edits or invalidation")
            };
            matches!(
                states.get(record_key),
                Some(Some(ProjectionState::Complete(document)))
                    if document.record_key == *record_key
                        && document.profile == *profile
                        && document.partition == *partition
            )
        })
        .collect())
}

/// Derive per-notification set edits for complete same-profile parents, resolving
/// ID-only patches against durable normalized identity. No aggregate snapshot is
/// stored in an optimistic layer: replay edits only this notification's
/// contribution, even after another layer fails.
pub async fn notification_projection_updates<S: Storage>(
    storage: &S,
    query: &str,
    operation_name: Option<&str>,
    variables: &serde_json::Map<String, serde_json::Value>,
    data: &serde_json::Value,
) -> Result<Vec<ProjectionMutation>, SoupFilterCacheAdapterError> {
    let document =
        Document::parse(query).map_err(|e| SoupFilterCacheAdapterError(e.to_string()))?;
    let operation = document
        .operation(operation_name)
        .map_err(|e| SoupFilterCacheAdapterError(e.to_string()))?;
    let updates = normalize(operation, variables, data)
        .map_err(|e| SoupFilterCacheAdapterError(e.to_string()))?;
    let updates = updates
        .into_iter()
        .filter(|(key, record)| {
            key.as_ref().starts_with("GraphqlNotification:") && record.fields.contains_key("state")
        })
        .collect::<Vec<_>>();
    let keys = updates
        .iter()
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let bases = storage
        .get_batch(&keys)
        .await
        .map_err(|e| SoupFilterCacheAdapterError(e.to_string()))?;
    let mut mutations = Vec::new();
    for ((key, update), base) in updates.into_iter().zip(bases) {
        let Some(id) = key
            .as_ref()
            .strip_prefix("GraphqlNotification:")
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        else {
            continue;
        };
        let mut record = base.unwrap_or_default();
        let previous = association(&record);
        record.merge(update);
        let next = association(&record);
        if previous != next
            && let Some((key, partition)) = previous
        {
            mutations.push(change(key, partition, id, None));
        }
        if let Some((key, partition)) = next {
            let state = match record.fields.get("state") {
                Some(CacheValue::String(state)) => state.as_str(),
                _ => "",
            };
            mutations.push(change(key, partition, id, Some(state)));
        }
    }
    retain_complete_parents(storage, mutations).await
}

/// Convert deterministic notification contributions into durable optimistic edits.
///
/// Returns an error for mutations other than member edits or invalidation.
pub fn optimistic_notification_updates(
    updates: Vec<ProjectionMutation>,
) -> Result<Vec<OptimisticProjectionMutation>, SoupFilterCacheAdapterError> {
    updates
        .into_iter()
        .map(|update| match update {
            ProjectionMutation::PatchExact {
                record_key,
                profile,
                partition,
                remove,
                insert,
            } => Ok(OptimisticProjectionMutation::PatchExact {
                record_key,
                profile,
                partition,
                remove,
                insert,
            }),
            ProjectionMutation::MarkIncomplete {
                record_key,
                profile,
                partition,
                ..
            } => Ok(OptimisticProjectionMutation::Unknown {
                record_key,
                profile,
                partition,
                affected_attributes: vec![
                    vocabulary::notification_unseen(),
                    vocabulary::notification_seen(),
                ],
            }),
            ProjectionMutation::Replace(_)
            | ProjectionMutation::Patch { .. }
            | ProjectionMutation::Delete(_) => Err(SoupFilterCacheAdapterError(
                "notification updates must be member edits or invalidation".to_owned(),
            )),
        })
        .collect()
}

/// Resolve complete parent projections for notification deletion/invalidation
/// before deleting the normalized notification records.
pub async fn notification_deletion_updates<S: Storage>(
    storage: &S,
    keys: &[String],
    invalidate: bool,
) -> Result<Vec<ProjectionMutation>, SoupFilterCacheAdapterError> {
    let keys = keys
        .iter()
        .filter(|key| key.starts_with("GraphqlNotification:"))
        .map(|key| EntityKey(key.clone().into()))
        .collect::<Vec<_>>();
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let records = storage
        .get_batch(&keys)
        .await
        .map_err(|e| SoupFilterCacheAdapterError(e.to_string()))?;
    let mutations = keys
        .into_iter()
        .zip(records)
        .filter_map(|(key, record)| {
            let (parent, partition) = association(&record?)?;
            if invalidate {
                return Some(ProjectionMutation::MarkIncomplete {
                    record_key: parent,
                    profile: vocabulary::profile_v4(),
                    partition,
                    kind: ProjectionIncompleteKind::Dirty,
                });
            }
            let id =
                uuid::Uuid::parse_str(key.as_ref().strip_prefix("GraphqlNotification:")?).ok()?;
            Some(change(parent, partition, id, None))
        })
        .collect();
    retain_complete_parents(storage, mutations).await
}
