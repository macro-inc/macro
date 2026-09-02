#![deny(missing_docs)]
//! Soup-specific browser adapter for the generic predicate-index cache.
//!
//! This crate owns the application GraphQL schema and Soup projection policy.
//! Cache crates receive only the generic query and projection IR produced here.

use cache_core::document::{Document, FieldNode, OperationKind, Selection};
use cache_core::meta::{self, FieldKind};
use cache_core::predicate::{ProjectionIncompleteKind, ProjectionMutation};
use graphql_soup_filter_input::materialize_graphql_filter;
use indexmap::IndexMap;
use item_filter_index::{
    LocalCompileOutcome, SoupFlatRequest, SoupIndexSort, compile_soup_flat_v3, vocabulary,
};
use predicate_index::{
    ExactAttributePatch, ExactValue, IndexDocument, OptimisticProjectionMutation, RecordKey,
    SortDirection, Token, ValidatedIndexQuery,
};
use soup_filter_projection::{
    DirectProjectionInput, DirectProjectionPatchInput, DocumentSubType,
    SoupCacheProjectionSupplement, SoupFlatEntityKind, compose_soup_flat_v3,
    decode_cache_projection_supplement, patch_direct_fields,
};
use std::collections::HashSet;

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
    compile_soup_flat_v3(
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

/// Derive authoritative generic projection mutations from a selected GraphQL response.
///
/// Document supplements are decoded only where `cacheProjection` is selected
/// for the surrounding entity and are merged with direct fields from that same
/// object. A selected null or missing Document supplement marks v3 incomplete;
/// selected null values on direct-only Projects and Chats are expected. Payloads
/// that omit the field become bounded v3 direct-field patches, preserving
/// server-owned facts from an existing complete projection. A payload without
/// direct projection fields emits an empty patch so an existing v3 projection is
/// retained while a missing base becomes explicitly incomplete.
pub fn authoritative_projection_mutations(
    query: &str,
    operation_name: Option<&str>,
    data: &serde_json::Value,
) -> Result<Vec<ProjectionMutation>, SoupFilterCacheAdapterError> {
    let document =
        Document::parse(query).map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?;
    let operation = document
        .operation(operation_name)
        .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?;
    let root_type = match operation.kind {
        OperationKind::Query => meta::QUERY_ROOT_TYPE,
        OperationKind::Mutation => meta::MUTATION_ROOT_TYPE.ok_or_else(|| {
            SoupFilterCacheAdapterError("GraphQL schema has no mutation root".to_owned())
        })?,
        OperationKind::Subscription => meta::SUBSCRIPTION_ROOT_TYPE.ok_or_else(|| {
            SoupFilterCacheAdapterError("GraphQL schema has no subscription root".to_owned())
        })?,
    };
    let serde_json::Value::Object(root) = data else {
        return Err(SoupFilterCacheAdapterError(
            "GraphQL response data is not an object".to_owned(),
        ));
    };

    let mut mutations = IndexMap::new();
    let mut has_unbound_incomplete_entity = false;
    walk_authoritative_object(
        &operation.selection_set,
        root_type,
        root,
        &mut mutations,
        &mut has_unbound_incomplete_entity,
    );
    let has_incomplete_projection = has_unbound_incomplete_entity
        || mutations
            .values()
            .any(|mutation| matches!(mutation, ProjectionMutation::MarkIncomplete { profile, .. } if profile == &vocabulary::profile_v3()));
    if operation_name.is_some_and(|name| name.starts_with("SoupBackfill"))
        && has_incomplete_projection
    {
        return Err(SoupFilterCacheAdapterError(
            "SoupBackfill page contains an incomplete required cache projection".to_owned(),
        ));
    }
    Ok(mutations.into_values().collect())
}

fn walk_authoritative_object(
    selections: &[Selection],
    declared_type: &str,
    object: &serde_json::Map<String, serde_json::Value>,
    mutations: &mut IndexMap<String, ProjectionMutation>,
    has_unbound_incomplete_entity: &mut bool,
) {
    let concrete_type = object
        .get("__typename")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(declared_type);
    let mut fields = Vec::new();
    collect_applicable_fields(selections, concrete_type, &mut fields);

    if let Some(partition) = projection_partition(concrete_type) {
        let mut projection_fields = fields
            .iter()
            .copied()
            .filter(|field| field.name == "cacheProjection")
            .collect::<Vec<_>>();
        projection_fields.sort_by(|left, right| left.response_key.cmp(&right.response_key));
        projection_fields.dedup_by(|left, right| left.response_key == right.response_key);

        let normalized_key = object
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(|id| format!("{concrete_type}:{id}"))
            .and_then(|key_text| {
                RecordKey::new(key_text.clone())
                    .ok()
                    .map(|key| (key_text, key))
            });
        if let Some((key_text, record_key)) = normalized_key {
            let kind = projection_kind(&partition).expect("supported partition has a kind");
            let mutation = if projection_fields.is_empty() {
                match authoritative_v3_patch_for_object(
                    record_key.clone(),
                    partition.clone(),
                    object,
                ) {
                    Ok(mutation) => Some(mutation),
                    Err(()) => Some(ProjectionMutation::MarkIncomplete {
                        record_key,
                        profile: vocabulary::profile_v3(),
                        partition,
                        kind: ProjectionIncompleteKind::Dirty,
                    }),
                }
            } else if kind == SoupFlatEntityKind::Document {
                Some(selected_document_projection_for_object(
                    record_key,
                    partition,
                    object,
                    &projection_fields,
                ))
            } else {
                Some(
                    complete_v3_projection_for_object(
                        record_key.clone(),
                        partition.clone(),
                        object,
                        None,
                    )
                    .map(ProjectionMutation::Replace)
                    .unwrap_or(ProjectionMutation::MarkIncomplete {
                        record_key,
                        profile: vocabulary::profile_v3(),
                        partition,
                        kind: ProjectionIncompleteKind::IncompatibleVersion,
                    }),
                )
            };

            if let Some(mutation) = mutation {
                insert_authoritative_mutation(mutations, key_text, mutation);
            }
        } else if !projection_fields.is_empty() {
            *has_unbound_incomplete_entity = true;
        }
    }

    let mut visited = HashSet::new();
    for field in fields {
        if !visited.insert((field.name.as_str(), field.response_key.as_str())) {
            continue;
        }
        let Some(value) = object.get(&field.response_key) else {
            continue;
        };
        let Some(field_meta) = meta::field_meta(concrete_type, &field.name) else {
            continue;
        };
        if field_meta.ty.kind != FieldKind::Composite {
            continue;
        }
        match value {
            serde_json::Value::Object(child) => walk_authoritative_object(
                &field.selection_set,
                field_meta.ty.name,
                child,
                mutations,
                has_unbound_incomplete_entity,
            ),
            serde_json::Value::Array(children) => {
                for child in children {
                    if let serde_json::Value::Object(child) = child {
                        walk_authoritative_object(
                            &field.selection_set,
                            field_meta.ty.name,
                            child,
                            mutations,
                            has_unbound_incomplete_entity,
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

fn collect_applicable_fields<'a>(
    selections: &'a [Selection],
    concrete_type: &str,
    fields: &mut Vec<&'a FieldNode>,
) {
    for selection in selections {
        match selection {
            Selection::Field(field) => fields.push(field),
            Selection::Fragment {
                type_condition,
                selection_set,
            } if type_condition
                .as_deref()
                .is_none_or(|condition| meta::type_matches(concrete_type, condition)) =>
            {
                collect_applicable_fields(selection_set, concrete_type, fields);
            }
            Selection::Fragment { .. } => {}
        }
    }
}

fn selected_document_projection_for_object(
    record_key: RecordKey,
    partition: Token,
    object: &serde_json::Map<String, serde_json::Value>,
    fields: &[&FieldNode],
) -> ProjectionMutation {
    let incomplete = |kind| ProjectionMutation::MarkIncomplete {
        record_key: record_key.clone(),
        profile: vocabulary::profile_v3(),
        partition: partition.clone(),
        kind,
    };
    let mut selected = None;
    for field in fields {
        let Some(value) = object.get(&field.response_key) else {
            return incomplete(ProjectionIncompleteKind::Missing);
        };
        if selected.is_some_and(|existing| existing != value) {
            return incomplete(ProjectionIncompleteKind::IncompatibleVersion);
        }
        selected = Some(value);
    }
    let Some(value) = selected else {
        return incomplete(ProjectionIncompleteKind::Missing);
    };
    let serde_json::Value::String(encoded) = value else {
        return incomplete(if value.is_null() {
            ProjectionIncompleteKind::Missing
        } else {
            ProjectionIncompleteKind::IncompatibleVersion
        });
    };
    let Ok(supplement) = decode_cache_projection_supplement(encoded) else {
        return incomplete(ProjectionIncompleteKind::IncompatibleVersion);
    };
    if supplement.target_profile() != &vocabulary::profile_v3()
        || supplement.record_key() != &record_key
        || supplement.partition() != &partition
    {
        return incomplete(ProjectionIncompleteKind::IncompatibleVersion);
    }
    complete_v3_projection_for_object(
        record_key.clone(),
        partition.clone(),
        object,
        Some(&supplement),
    )
    .map(ProjectionMutation::Replace)
    .unwrap_or_else(|()| incomplete(ProjectionIncompleteKind::IncompatibleVersion))
}

fn insert_authoritative_mutation(
    mutations: &mut IndexMap<String, ProjectionMutation>,
    key: String,
    mutation: ProjectionMutation,
) {
    let mutation_is_empty_patch = matches!(
        &mutation,
        ProjectionMutation::Patch {
            exact,
            integers,
            sorts,
            ..
        } if exact.is_empty() && integers.is_empty() && sorts.is_empty()
    );
    if mutation_is_empty_patch && mutations.contains_key(&key) {
        return;
    }

    let existing_is_replace = matches!(mutations.get(&key), Some(ProjectionMutation::Replace(_)));
    if matches!(mutation, ProjectionMutation::Replace(_)) || !existing_is_replace {
        mutations.insert(key, mutation);
    }
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
                                profile: vocabulary::profile_v3(),
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
                            profile: vocabulary::profile_v3(),
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
                profile: vocabulary::profile_v3(),
                partition,
                kind: ProjectionIncompleteKind::Dirty,
            })
        })
        .collect()
}

fn direct_projection_input_for_object(
    record_key: RecordKey,
    partition: &Token,
    object: &serde_json::Map<String, serde_json::Value>,
    updated_at_fallback_ms: Option<i64>,
) -> Option<DirectProjectionInput> {
    let kind = projection_kind(partition)?;
    let project_field = if kind == SoupFlatEntityKind::Project {
        "parentId"
    } else {
        "projectId"
    };
    let updated_at = match object.get("updatedAt") {
        Some(value) => graphql_timestamp(value)?,
        None => chrono::DateTime::from_timestamp_millis(updated_at_fallback_ms?)?,
    };
    Some(DirectProjectionInput {
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
}

fn complete_v3_projection_for_object(
    record_key: RecordKey,
    partition: Token,
    object: &serde_json::Map<String, serde_json::Value>,
    supplement: Option<&SoupCacheProjectionSupplement>,
) -> Result<IndexDocument, ()> {
    let input =
        direct_projection_input_for_object(record_key, &partition, object, None).ok_or(())?;
    let sub_type = if input.kind == SoupFlatEntityKind::Document {
        document_sub_type(object.get("subType").ok_or(())?)?
    } else {
        None
    };
    compose_soup_flat_v3(input, sub_type, supplement).map_err(|_| ())
}

fn authoritative_v3_patch_for_object(
    record_key: RecordKey,
    partition: Token,
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<ProjectionMutation, ()> {
    let kind = projection_kind(&partition).ok_or(())?;
    let project_field = if kind == SoupFlatEntityKind::Project {
        "parentId"
    } else {
        "projectId"
    };
    let has_direct_patch = ["ownerId", project_field, "createdAt", "updatedAt"]
        .iter()
        .any(|field| object.contains_key(*field))
        || (kind == SoupFlatEntityKind::Document
            && (object.contains_key("fileType") || object.contains_key("subType")));
    if !has_direct_patch {
        return Ok(ProjectionMutation::Patch {
            record_key,
            profile: vocabulary::profile_v3(),
            partition,
            exact: Vec::new(),
            integers: Vec::new(),
            sorts: Vec::new(),
        });
    }

    let patch = patch_direct_fields(DirectProjectionPatchInput {
        record_key: record_key.clone(),
        kind,
        owner: match object.get("ownerId") {
            Some(value) => Some(value.as_str().ok_or(())?.to_owned()),
            None => None,
        },
        project_id: match object.get(project_field) {
            Some(value) => Some(optional_uuid(value).ok_or(())?),
            None => None,
        },
        file_type: if kind == SoupFlatEntityKind::Document {
            match object.get("fileType") {
                Some(value) => Some(optional_string(value).ok_or(())?),
                None => None,
            }
        } else {
            None
        },
        created_at: match object.get("createdAt") {
            Some(value) => Some(graphql_timestamp(value).ok_or(())?),
            None => None,
        },
        updated_at: match object.get("updatedAt") {
            Some(value) => Some(graphql_timestamp(value).ok_or(())?),
            None => None,
        },
    })
    .map_err(|_| ())?;
    let OptimisticProjectionMutation::Patch {
        mut exact,
        integers,
        sorts,
        ..
    } = patch
    else {
        return Err(());
    };

    if kind == SoupFlatEntityKind::Document
        && let Some(value) = object.get("subType")
    {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::document_sub_type(),
            values: document_sub_type_values(value)?,
        });
    }
    Ok(ProjectionMutation::Patch {
        record_key,
        profile: vocabulary::profile_v3(),
        partition,
        exact,
        integers,
        sorts,
    })
}

fn document_sub_type(value: &serde_json::Value) -> Result<Option<DocumentSubType>, ()> {
    match value {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Object(object) => {
            match object.get("__typename").and_then(serde_json::Value::as_str) {
                Some("GraphqlTaskSubType") => Ok(Some(DocumentSubType::Task)),
                Some("GraphqlSnippetSubType") => Ok(Some(DocumentSubType::Snippet)),
                Some("GraphqlSkillSubType") => Ok(Some(DocumentSubType::Skill)),
                _ => Err(()),
            }
        }
        _ => Err(()),
    }
}

fn document_sub_type_values(value: &serde_json::Value) -> Result<Vec<ExactValue>, ()> {
    Ok(document_sub_type(value)?
        .map(|sub_type| ExactValue::utf8(sub_type.to_string()).map_err(|_| ()))
        .transpose()?
        .into_iter()
        .collect())
}

fn optimistic_projection_for_object(
    record_key: RecordKey,
    partition: Token,
    object: &serde_json::Map<String, serde_json::Value>,
    created_at_ms: i64,
) -> Option<OptimisticProjectionMutation> {
    let kind = projection_kind(&partition)?;
    if kind != SoupFlatEntityKind::Document
        && let Some(input) = direct_projection_input_for_object(
            record_key.clone(),
            &partition,
            object,
            Some(created_at_ms),
        )
    {
        let document = compose_soup_flat_v3(input, None, None).ok()?;
        return Some(OptimisticProjectionMutation::Replace(document));
    }

    let project_field = if kind == SoupFlatEntityKind::Project {
        "parentId"
    } else {
        "projectId"
    };
    let updated_at = match object.get("updatedAt") {
        Some(value) => graphql_timestamp(value)?,
        None => chrono::DateTime::from_timestamp_millis(created_at_ms)?,
    };
    let patch = patch_direct_fields(DirectProjectionPatchInput {
        record_key: record_key.clone(),
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
        updated_at: Some(updated_at),
    })
    .ok()?;
    let OptimisticProjectionMutation::Patch {
        mut exact,
        integers,
        sorts,
        ..
    } = patch
    else {
        return None;
    };
    if kind == SoupFlatEntityKind::Document
        && let Some(value) = object.get("subType")
    {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::document_sub_type(),
            values: document_sub_type_values(value).ok()?,
        });
    }
    Some(OptimisticProjectionMutation::Patch {
        record_key,
        profile: vocabulary::profile_v3(),
        partition,
        exact,
        integers,
        sorts,
    })
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
