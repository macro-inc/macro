#![deny(missing_docs)]
//! Soup-specific browser adapter for the generic predicate-index cache.
//!
//! This crate owns the application GraphQL schema and `soup-flat-v1` policy.
//! Cache crates receive only the generic query and projection IR produced here.

use cache_core::predicate::{ProjectionIncompleteKind, ProjectionMutation};
use graphql_soup_filter_input::materialize_graphql_filter;
use indexmap::IndexMap;
use item_filter_index::{
    LocalCompileOutcome, SoupFlatRequest, SoupIndexSort, compile_soup_flat_v1, vocabulary,
};
use predicate_index::{
    IndexDocument, OptimisticProjectionMutation, RecordKey, SortDirection, Token,
    ValidatedIndexQuery,
};
use soup_filter_projection::{
    DirectProjectionInput, DirectProjectionPatchInput, SoupFlatEntityKind, patch_direct_fields,
    project_direct_fields,
};
use std::collections::HashMap;

/// Failure to materialize or compile a Soup filter request.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct SoupFilterCacheAdapterError(String);

/// Result of compiling a Soup request to generic predicate-index IR.
#[derive(Debug)]
pub enum SoupFilterCompileOutcome {
    /// The request is outside the exact local support profile.
    Unsupported,
    /// A validated generic query that the cache can evaluate exactly.
    Supported(ValidatedIndexQuery),
}

/// Compile one GraphQL Soup request into generic predicate-index IR.
pub fn compile_filter_request(
    filters: serde_json::Value,
    sort_method: &str,
    sort_direction: &str,
    limit: u16,
) -> Result<SoupFilterCompileOutcome, SoupFilterCacheAdapterError> {
    let ast = materialize_graphql_filter(filters)
        .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?;
    let sort = match sort_method {
        "CREATED_AT" => SoupIndexSort::CreatedAt,
        "UPDATED_AT" => SoupIndexSort::UpdatedAt,
        _ => SoupIndexSort::Unsupported,
    };
    let direction = match sort_direction {
        "ASC" => SortDirection::Asc,
        "DESC" => SortDirection::Desc,
        _ => {
            return Err(SoupFilterCacheAdapterError(
                "invalid entity-filter sort direction".to_owned(),
            ));
        }
    };
    compile_soup_flat_v1(
        &ast,
        SoupFlatRequest {
            sort,
            direction,
            limit,
            has_cursor: false,
        },
    )
    .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))
    .map(|outcome| match outcome {
        LocalCompileOutcome::Unsupported(_) => SoupFilterCompileOutcome::Unsupported,
        LocalCompileOutcome::Supported(query) => SoupFilterCompileOutcome::Supported(query),
    })
}

/// Derive authoritative generic projection mutations from a GraphQL response.
pub fn authoritative_projection_mutations(data: &serde_json::Value) -> Vec<ProjectionMutation> {
    fn walk(value: &serde_json::Value, mutations: &mut HashMap<String, ProjectionMutation>) {
        match value {
            serde_json::Value::Array(values) => {
                for value in values {
                    walk(value, mutations);
                }
            }
            serde_json::Value::Object(object) => {
                let typename = object.get("__typename").and_then(|value| value.as_str());
                let id = object.get("id").and_then(|value| value.as_str());
                if let (Some(typename), Some(id)) = (typename, id)
                    && let Some(partition) = projection_partition(typename)
                {
                    let key_text = format!("{typename}:{id}");
                    if let Ok(record_key) = RecordKey::new(key_text.clone()) {
                        let mutation = direct_projection_for_object(
                            record_key.clone(),
                            partition.clone(),
                            object,
                            None,
                        )
                        .map(ProjectionMutation::Replace)
                        .unwrap_or(ProjectionMutation::MarkIncomplete {
                            record_key,
                            profile: vocabulary::profile(),
                            partition,
                            kind: ProjectionIncompleteKind::Dirty,
                        });
                        let replace = matches!(mutation, ProjectionMutation::Replace(_));
                        if replace
                            || !matches!(
                                mutations.get(&key_text),
                                Some(ProjectionMutation::Replace(_))
                            )
                        {
                            mutations.insert(key_text, mutation);
                        }
                    }
                }
                for value in object.values() {
                    walk(value, mutations);
                }
            }
            _ => {}
        }
    }

    let mut mutations = HashMap::new();
    walk(data, &mut mutations);
    mutations.into_values().collect()
}

/// Derive ordered generic optimistic projection mutations from a GraphQL response.
pub fn optimistic_projection_mutations(
    data: &serde_json::Value,
    created_at_ms: i64,
) -> Vec<OptimisticProjectionMutation> {
    fn walk(
        value: &serde_json::Value,
        created_at_ms: i64,
        mutations: &mut IndexMap<String, OptimisticProjectionMutation>,
    ) {
        match value {
            serde_json::Value::Array(values) => {
                for value in values {
                    walk(value, created_at_ms, mutations);
                }
            }
            serde_json::Value::Object(object) => {
                if object.get("__typename").and_then(|value| value.as_str())
                    == Some("GraphqlCacheDeletion")
                    && let (Some(typename), Some(id)) = (
                        object
                            .get("graphqlTypeName")
                            .and_then(|value| value.as_str()),
                        object.get("entityId").and_then(|value| value.as_str()),
                    )
                    && let Some(partition) = projection_partition(typename)
                {
                    let key_text = format!("{typename}:{id}");
                    if let Ok(record_key) = RecordKey::new(key_text.clone()) {
                        mutations.insert(
                            key_text,
                            OptimisticProjectionMutation::Delete {
                                record_key,
                                profile: vocabulary::profile(),
                                partition,
                            },
                        );
                    }
                }

                let typename = object.get("__typename").and_then(|value| value.as_str());
                let id = object.get("id").and_then(|value| value.as_str());
                if let (Some(typename), Some(id)) = (typename, id)
                    && let Some(partition) = projection_partition(typename)
                {
                    let key_text = format!("{typename}:{id}");
                    if let Ok(record_key) = RecordKey::new(key_text.clone()) {
                        let mutation = optimistic_projection_for_object(
                            record_key.clone(),
                            partition.clone(),
                            object,
                            created_at_ms,
                        )
                        .unwrap_or(OptimisticProjectionMutation::Unknown {
                            record_key,
                            profile: vocabulary::profile(),
                            partition,
                            affected_attributes: Vec::new(),
                        });
                        if !matches!(
                            mutations.get(&key_text),
                            Some(OptimisticProjectionMutation::Delete { .. })
                        ) {
                            mutations.insert(key_text, mutation);
                        }
                    }
                }
                for value in object.values() {
                    walk(value, created_at_ms, mutations);
                }
            }
            _ => {}
        }
    }

    let mut mutations = IndexMap::new();
    walk(data, created_at_ms, &mut mutations);
    mutations.into_values().collect()
}

/// Mark projections associated with known Soup record keys dirty.
pub fn dirty_projection_mutations(keys: &[String]) -> Vec<ProjectionMutation> {
    keys.iter()
        .filter_map(|key| {
            let (typename, _) = key.split_once(':')?;
            let partition = projection_partition(typename)?;
            Some(ProjectionMutation::MarkIncomplete {
                record_key: RecordKey::new(key.clone()).ok()?,
                profile: vocabulary::profile(),
                partition,
                kind: ProjectionIncompleteKind::Dirty,
            })
        })
        .collect()
}

fn direct_projection_for_object(
    record_key: RecordKey,
    partition: Token,
    object: &serde_json::Map<String, serde_json::Value>,
    updated_at_fallback_ms: Option<i64>,
) -> Option<IndexDocument> {
    let kind = projection_kind(&partition)?;
    let project_field = if kind == SoupFlatEntityKind::Project {
        "parentId"
    } else {
        "projectId"
    };
    let updated_at = match object.get("updatedAt") {
        Some(value) => graphql_timestamp(value)?,
        None => chrono::DateTime::from_timestamp_millis(updated_at_fallback_ms?)?,
    };
    project_direct_fields(DirectProjectionInput {
        record_key,
        kind,
        id: uuid::Uuid::parse_str(object.get("id")?.as_str()?).ok()?,
        owner: object.get("ownerId")?.as_str()?.to_owned(),
        project_id: optional_uuid(object.get(project_field)?)?,
        file_type: if kind == SoupFlatEntityKind::Document {
            optional_string(object.get("fileType")?)?
        } else {
            None
        },
        created_at: graphql_timestamp(object.get("createdAt")?)?,
        updated_at,
    })
    .ok()
}

fn optimistic_projection_for_object(
    record_key: RecordKey,
    partition: Token,
    object: &serde_json::Map<String, serde_json::Value>,
    created_at_ms: i64,
) -> Option<OptimisticProjectionMutation> {
    if let Some(document) = direct_projection_for_object(
        record_key.clone(),
        partition.clone(),
        object,
        Some(created_at_ms),
    ) {
        return Some(OptimisticProjectionMutation::Replace(document));
    }

    let kind = projection_kind(&partition)?;
    let project_field = if kind == SoupFlatEntityKind::Project {
        "parentId"
    } else {
        "projectId"
    };
    let updated_at = match object.get("updatedAt") {
        Some(value) => graphql_timestamp(value)?,
        None => chrono::DateTime::from_timestamp_millis(created_at_ms)?,
    };
    patch_direct_fields(DirectProjectionPatchInput {
        record_key,
        kind,
        owner: match object.get("ownerId") {
            Some(value) => Some(value.as_str()?.to_owned()),
            None => None,
        },
        project_id: match object.get(project_field) {
            Some(value) => Some(optional_uuid(value)?),
            None => None,
        },
        file_type: if kind == SoupFlatEntityKind::Document {
            match object.get("fileType") {
                Some(value) => Some(optional_string(value)?),
                None => None,
            }
        } else {
            None
        },
        created_at: match object.get("createdAt") {
            Some(value) => Some(graphql_timestamp(value)?),
            None => None,
        },
        updated_at,
    })
    .ok()
}

fn projection_kind(partition: &Token) -> Option<SoupFlatEntityKind> {
    if partition == &vocabulary::document_partition() {
        Some(SoupFlatEntityKind::Document)
    } else if partition == &vocabulary::project_partition() {
        Some(SoupFlatEntityKind::Project)
    } else if partition == &vocabulary::chat_partition() {
        Some(SoupFlatEntityKind::Chat)
    } else {
        None
    }
}

fn optional_uuid(value: &serde_json::Value) -> Option<Option<uuid::Uuid>> {
    match value {
        serde_json::Value::Null => Some(None),
        serde_json::Value::String(value) => Some(Some(uuid::Uuid::parse_str(value).ok()?)),
        _ => None,
    }
}

fn optional_string(value: &serde_json::Value) -> Option<Option<String>> {
    match value {
        serde_json::Value::Null => Some(None),
        serde_json::Value::String(value) => Some(Some(value.clone())),
        _ => None,
    }
}

fn graphql_timestamp(value: &serde_json::Value) -> Option<chrono::DateTime<chrono::Utc>> {
    Some(
        chrono::DateTime::parse_from_rfc3339(value.as_str()?)
            .ok()?
            .with_timezone(&chrono::Utc),
    )
}

fn projection_partition(typename: &str) -> Option<Token> {
    match typename {
        "GraphqlSoupDocument" => Some(vocabulary::document_partition()),
        "GraphqlSoupProject" => Some(vocabulary::project_partition()),
        "GraphqlSoupChat" => Some(vocabulary::chat_partition()),
        _ => None,
    }
}

#[cfg(test)]
mod test;
