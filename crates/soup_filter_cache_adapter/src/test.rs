use serde::Deserialize;
use soup_filter_projection::{
    SoupCacheProjectionSupplement, decode_cache_projection_supplement,
    encode_cache_projection_supplement, validate_soup_flat_v3,
};
use std::collections::BTreeMap;

use super::*;

#[test]
fn optimistic_soup_payloads_compile_to_durable_projection_layers() {
    let mutations = optimistic_projection_mutations(
        &serde_json::json!({
            "update": {
                "__typename": "GraphqlSoupDocument",
                "id": "00000000-0000-0000-0000-000000000001",
                "projectId": "00000000-0000-0000-0000-000000000002"
            }
        }),
        123,
    );
    assert_eq!(mutations.len(), 1);
    let OptimisticProjectionMutation::Patch {
        profile,
        exact,
        integers,
        sorts,
        ..
    } = &mutations[0]
    else {
        panic!("partial optimistic Soup entity should compile to a patch");
    };
    assert_eq!(profile, &vocabulary::profile_v3());
    assert!(
        exact
            .iter()
            .any(|patch| patch.attribute == vocabulary::project_id())
    );
    assert!(integers.iter().any(|patch| {
        patch.attribute == vocabulary::updated_at() && patch.values == vec![123_000]
    }));
    assert!(
        sorts
            .iter()
            .any(|fact| { fact.attribute == vocabulary::updated_at() && fact.value == 123_000 })
    );

    let document_create = optimistic_projection_mutations(
        &serde_json::json!({
            "create": {
                "__typename": "GraphqlSoupDocument",
                "id": "00000000-0000-0000-0000-000000000002",
                "ownerId": "user-1",
                "projectId": null,
                "fileType": "md",
                "subType": null,
                "createdAt": "2025-01-01T00:00:00.000001Z"
            }
        }),
        456,
    );
    let [OptimisticProjectionMutation::Patch { profile, exact, .. }] = document_create.as_slice()
    else {
        panic!("a document create without server facts must patch, not claim completeness");
    };
    assert_eq!(profile, &vocabulary::profile_v3());
    assert!(
        exact
            .iter()
            .any(|patch| patch.attribute == vocabulary::document_sub_type())
    );
    assert!(
        exact
            .iter()
            .all(|patch| patch.attribute != vocabulary::email_attachment())
    );

    let complete = optimistic_projection_mutations(
        &serde_json::json!({
            "create": {
                "__typename": "GraphqlSoupProject",
                "id": "00000000-0000-0000-0000-000000000003",
                "ownerId": "user-1",
                "parentId": null,
                "createdAt": "2025-01-01T00:00:00.000001Z"
            }
        }),
        456,
    );
    let [OptimisticProjectionMutation::Replace(complete)] = complete.as_slice() else {
        panic!("a project optimistic create has every required v3 fact");
    };
    assert_eq!(complete.profile, vocabulary::profile_v3());

    let deletion = optimistic_projection_mutations(
        &serde_json::json!({
            "result": [
                {
                    "__typename": "GraphqlCacheDeletion",
                    "graphqlTypeName": "GraphqlSoupChat",
                    "entityId": "00000000-0000-0000-0000-000000000004"
                },
                {
                    "__typename": "GraphqlSoupChat",
                    "id": "00000000-0000-0000-0000-000000000004",
                    "projectId": null
                }
            ]
        }),
        789,
    );
    assert!(matches!(
        deletion.as_slice(),
        [OptimisticProjectionMutation::Delete { .. }]
    ));
}

#[test]
fn optimistic_mutations_keep_first_seen_order_and_deletion_precedence() {
    let mutations = optimistic_projection_mutations(
        &serde_json::json!({
            "result": [
                {
                    "__typename": "GraphqlSoupChat",
                    "id": "00000000-0000-0000-0000-000000000004",
                    "projectId": null
                },
                {
                    "__typename": "GraphqlSoupDocument",
                    "id": "00000000-0000-0000-0000-000000000005",
                    "projectId": null
                },
                {
                    "__typename": "GraphqlCacheDeletion",
                    "graphqlTypeName": "GraphqlSoupChat",
                    "entityId": "00000000-0000-0000-0000-000000000004"
                },
                {
                    "__typename": "GraphqlSoupChat",
                    "id": "00000000-0000-0000-0000-000000000004",
                    "projectId": "00000000-0000-0000-0000-000000000006"
                }
            ]
        }),
        789,
    );

    assert_eq!(mutations.len(), 2);
    assert_eq!(
        mutations[0].record_key().as_str(),
        "GraphqlSoupChat:00000000-0000-0000-0000-000000000004"
    );
    assert!(matches!(
        mutations[0],
        OptimisticProjectionMutation::Delete { .. }
    ));
    assert_eq!(
        mutations[1].record_key().as_str(),
        "GraphqlSoupDocument:00000000-0000-0000-0000-000000000005"
    );
}

#[test]
fn authoritative_direct_fields_without_projection_schema_field_become_v3_patch() {
    let query = r#"query LegacySoup {
        user {
            soup(input: { limit: 1 }) {
                items {
                    __typename
                    id
                    ... on GraphqlSoupDocument {
                        ownerId
                        projectId
                        fileType
                        createdAt
                        updatedAt
                    }
                }
            }
        }
    }"#;
    let mutations = authoritative_projection_mutations(
        query,
        Some("LegacySoup"),
        &serde_json::json!({
            "user": {
                "soup": {
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": "00000000-0000-0000-0000-000000000001",
                        "ownerId": "user-1",
                        "projectId": null,
                        "fileType": "md",
                        "createdAt": "2025-01-01T00:00:00.000001Z",
                        "updatedAt": "2025-01-02T00:00:00.000001Z"
                    }]
                }
            }
        }),
    )
    .expect("legacy query parses");
    assert!(matches!(
        mutations.as_slice(),
        [ProjectionMutation::Patch { profile, .. }]
            if profile == &vocabulary::profile_v3()
    ));
}

#[test]
fn partial_queries_preserve_v3_authority_and_mark_missing_v3() {
    let id = "00000000-0000-0000-0000-000000000001";
    let base_mutations = authoritative_projection_mutations(
        SUPPLEMENT_SUBSCRIPTION,
        Some("Supplement"),
        &supplement_subscription_data(selected_document(
            id,
            serde_json::Value::String(document_supplement(id, false)),
            serde_json::Value::Null,
        )),
    )
    .unwrap();
    let [ProjectionMutation::Replace(base)] = base_mutations.as_slice() else {
        panic!("complete Soup data must hydrate v3 authority");
    };
    let base = base.clone();
    let key = base.record_key.clone();

    let query = r#"query SoupNotifications {
        user {
            soup(input: { limit: 500 }) {
                items {
                    __typename
                    id
                    notifications { id }
                }
            }
        }
    }"#;
    let mutations = authoritative_projection_mutations(
        query,
        Some("SoupNotifications"),
        &serde_json::json!({
            "user": {
                "soup": {
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": id,
                        "notifications": []
                    }]
                }
            }
        }),
    )
    .unwrap();
    let [
        ProjectionMutation::Patch {
            profile,
            exact,
            integers,
            sorts,
            ..
        },
    ] = mutations.as_slice()
    else {
        panic!("a projection-less partial query must produce a bounded v3 patch");
    };
    assert_eq!(profile, &vocabulary::profile_v3());
    assert!(exact.is_empty());
    assert!(integers.is_empty());
    assert!(sorts.is_empty());

    let mut existing = std::collections::HashMap::from([(
        key.clone(),
        cache_core::predicate::ProjectionState::Complete(base.clone()),
    )]);
    cache_core::predicate::apply_authoritative_projection_mutations(&mut existing, &mutations);
    assert_eq!(
        existing.get(&key),
        Some(&cache_core::predicate::ProjectionState::Complete(base))
    );

    let mut missing = std::collections::HashMap::new();
    cache_core::predicate::apply_authoritative_projection_mutations(&mut missing, &mutations);
    assert!(matches!(
        missing.get(&key),
        Some(cache_core::predicate::ProjectionState::Incomplete {
            profile,
            kind: ProjectionIncompleteKind::Missing,
            ..
        }) if profile == &vocabulary::profile_v3()
    ));
}

#[test]
fn empty_query_patch_does_not_overwrite_an_earlier_field_patch() {
    let id = "00000000-0000-0000-0000-000000000001";
    let query = r#"query RepeatedSoupEntity {
        user {
            rich: soup(input: { limit: 1 }) {
                items {
                    __typename
                    id
                    ... on GraphqlSoupDocument {
                        ownerId
                        projectId
                        fileType
                        createdAt
                        updatedAt
                        subType { __typename }
                    }
                }
            }
            partial: soup(input: { limit: 1 }) {
                items {
                    __typename
                    id
                    notifications { id }
                }
            }
        }
    }"#;
    let mutations = authoritative_projection_mutations(
        query,
        Some("RepeatedSoupEntity"),
        &serde_json::json!({
            "user": {
                "rich": {
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": id,
                        "ownerId": "macro|owner@example.com",
                        "projectId": null,
                        "fileType": "md",
                        "createdAt": "2025-01-01T00:00:00.000001Z",
                        "updatedAt": "2025-01-02T00:00:00.000001Z",
                        "subType": null
                    }]
                },
                "partial": {
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": id,
                        "notifications": []
                    }]
                }
            }
        }),
    )
    .unwrap();
    let [
        ProjectionMutation::Patch {
            exact,
            integers,
            sorts,
            ..
        },
    ] = mutations.as_slice()
    else {
        panic!("the richer appearance must retain its field patch");
    };
    assert!(exact.iter().any(|patch| {
        patch.attribute == vocabulary::owner()
            && patch.values == vec![ExactValue::utf8("macro|owner@example.com").unwrap()]
    }));
    assert!(
        integers
            .iter()
            .any(|patch| patch.attribute == vocabulary::updated_at())
    );
    assert!(
        sorts
            .iter()
            .any(|fact| fact.attribute == vocabulary::updated_at())
    );
}

const SUPPLEMENT_SUBSCRIPTION: &str = r#"subscription Supplement {
    soupUpdates {
        __typename
        ... on SoupUpdated {
            item {
                __typename
                id
                cacheProjection @cacheOnly
                ... on GraphqlSoupDocument {
                    ownerId
                    projectId
                    fileType
                    createdAt
                    updatedAt
                    subType { __typename }
                }
            }
        }
    }
}"#;

const SUPPLEMENT_BACKFILL: &str = r#"query SoupBackfill {
    user {
        soup(input: { initial: { limit: 1 } }) {
            items {
                __typename
                id
                cacheProjection @cacheOnly
                ... on GraphqlSoupDocument {
                    ownerId
                    projectId
                    fileType
                    createdAt
                    updatedAt
                    subType { __typename }
                }
            }
        }
    }
}"#;

fn document_supplement(id: &str, is_email_attachment: bool) -> String {
    document_supplement_with_task_facts(id, is_email_attachment, true, Vec::new())
}

fn document_supplement_with_task_facts(
    id: &str,
    is_email_attachment: bool,
    is_important: bool,
    status_option_ids: Vec<uuid::Uuid>,
) -> String {
    encode_cache_projection_supplement(&SoupCacheProjectionSupplement::document(
        RecordKey::new(format!("GraphqlSoupDocument:{id}")).unwrap(),
        is_email_attachment,
        is_important,
        status_option_ids,
    ))
    .unwrap()
}

fn selected_document(
    id: &str,
    cache_projection: serde_json::Value,
    sub_type: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "__typename": "GraphqlSoupDocument",
        "id": id,
        "cacheProjection": cache_projection,
        "ownerId": "macro|owner@example.com",
        "projectId": null,
        "fileType": "md",
        "createdAt": "2025-01-01T00:00:00.000001Z",
        "updatedAt": "2025-01-02T00:00:00.000001Z",
        "subType": sub_type,
    })
}

fn supplement_subscription_data(item: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "soupUpdates": [{
            "__typename": "SoupUpdated",
            "item": item,
        }]
    })
}

#[test]
fn selected_document_supplement_composes_direct_and_server_owned_facts() {
    let id = "00000000-0000-0000-0000-000000000001";
    let encoded = document_supplement(id, false);
    let mutations = authoritative_projection_mutations(
        SUPPLEMENT_SUBSCRIPTION,
        Some("Supplement"),
        &supplement_subscription_data(selected_document(
            id,
            serde_json::Value::String(encoded),
            serde_json::Value::Null,
        )),
    )
    .unwrap();
    let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
        panic!("a valid selected supplement and direct fields must replace authority");
    };
    assert_eq!(document.profile, vocabulary::profile_v3());
    assert_eq!(document.partition, vocabulary::document_partition());
    assert!(document.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::owner()
            && fact.value == ExactValue::utf8("macro|owner@example.com").unwrap()
    }));
    assert!(document.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::email_attachment()
            && fact.value == ExactValue::new([0]).unwrap()
    }));

    let attached = authoritative_projection_mutations(
        SUPPLEMENT_SUBSCRIPTION,
        Some("Supplement"),
        &supplement_subscription_data(selected_document(
            id,
            serde_json::Value::String(document_supplement(id, true)),
            serde_json::Value::Null,
        )),
    )
    .unwrap();
    let [ProjectionMutation::Replace(attached)] = attached.as_slice() else {
        panic!("authoritative attachment state must compose");
    };
    let mut attached = attached.clone();
    let mut unattached = document.clone();
    let is_attachment =
        |fact: &predicate_index::ExactFact| fact.attribute == vocabulary::email_attachment();
    assert!(
        attached
            .exact_facts
            .iter()
            .any(|fact| { is_attachment(fact) && fact.value == ExactValue::new([1]).unwrap() })
    );
    attached.exact_facts.retain(|fact| !is_attachment(fact));
    unattached.exact_facts.retain(|fact| !is_attachment(fact));
    assert_eq!(
        attached, unattached,
        "the supplement contributes no direct facts"
    );
}

#[test]
fn selected_document_supplement_composes_importance_and_status_facts() {
    let id = "00000000-0000-0000-0000-000000000001";
    let status_a = uuid::Uuid::from_u128(11);
    let status_b = uuid::Uuid::from_u128(12);
    let mutations = authoritative_projection_mutations(
        SUPPLEMENT_SUBSCRIPTION,
        Some("Supplement"),
        &supplement_subscription_data(selected_document(
            id,
            serde_json::Value::String(document_supplement_with_task_facts(
                id,
                false,
                false,
                vec![status_b, status_a],
            )),
            serde_json::json!({ "__typename": "GraphqlTaskSubType" }),
        )),
    )
    .unwrap();
    let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
        panic!("viewer-relative facts must compose into one complete projection");
    };
    assert!(document.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::importance() && fact.value == ExactValue::new([0]).unwrap()
    }));
    let statuses = document
        .exact_facts
        .iter()
        .filter(|fact| fact.attribute == vocabulary::task_status_option())
        .map(|fact| fact.value.as_bytes())
        .collect::<Vec<_>>();
    assert_eq!(statuses, vec![status_a.as_bytes(), status_b.as_bytes()]);
}

#[test]
fn document_subtype_postings_are_composed_from_graphql_typenames() {
    for (suffix, typename, expected) in [
        (2, "GraphqlTaskSubType", "task"),
        (3, "GraphqlSnippetSubType", "snippet"),
        (4, "GraphqlSkillSubType", "skill"),
    ] {
        let id = format!("00000000-0000-0000-0000-{suffix:012}");
        let mutations = authoritative_projection_mutations(
            SUPPLEMENT_SUBSCRIPTION,
            Some("Supplement"),
            &supplement_subscription_data(selected_document(
                &id,
                serde_json::Value::String(document_supplement(&id, false)),
                serde_json::json!({ "__typename": typename }),
            )),
        )
        .unwrap();
        let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
            panic!("{typename} must compose a complete Document projection");
        };
        assert!(document.exact_facts.iter().any(|fact| {
            fact.attribute == vocabulary::document_sub_type()
                && fact.value == ExactValue::utf8(expected).unwrap()
        }));
    }
}

#[test]
fn selected_project_and_chat_null_supplements_are_valid_direct_only_v3_hydration() {
    let query = r#"query SoupBackfill {
        user { soup(input: { initial: { limit: 2 } }) { items {
            __typename
            id
            cacheProjection @cacheOnly
            ... on GraphqlSoupProject { ownerId parentId createdAt updatedAt }
            ... on GraphqlSoupChat { ownerId projectId createdAt updatedAt }
        } } }
    }"#;
    let mutations = authoritative_projection_mutations(
        query,
        Some("SoupBackfill"),
        &serde_json::json!({
            "user": { "soup": { "items": [
                {
                    "__typename": "GraphqlSoupProject",
                    "id": "00000000-0000-0000-0000-000000000010",
                    "cacheProjection": null,
                    "ownerId": "macro|owner@example.com",
                    "parentId": null,
                    "createdAt": "2025-01-01T00:00:00Z",
                    "updatedAt": "2025-01-02T00:00:00Z"
                },
                {
                    "__typename": "GraphqlSoupChat",
                    "id": "00000000-0000-0000-0000-000000000011",
                    "cacheProjection": null,
                    "ownerId": "macro|owner@example.com",
                    "projectId": null,
                    "createdAt": "2025-01-01T00:00:00Z",
                    "updatedAt": "2025-01-02T00:00:00Z"
                }
            ] } }
        }),
    )
    .expect("direct-only entities must not fail strict backfill");
    assert_eq!(mutations.len(), 2);
    for mutation in &mutations {
        let ProjectionMutation::Replace(document) = mutation else {
            panic!("direct-only entity must produce a complete replacement");
        };
        validate_soup_flat_v3(document).unwrap();
        assert_ne!(document.partition, vocabulary::document_partition());
    }
}

#[test]
fn missing_malformed_or_mismatched_document_supplements_remain_incomplete() {
    let id = "00000000-0000-0000-0000-000000000001";
    let mut absent = selected_document(id, serde_json::Value::Null, serde_json::Value::Null);
    absent.as_object_mut().unwrap().remove("cacheProjection");
    for (name, item, expected_kind) in [
        ("absent", absent, ProjectionIncompleteKind::Missing),
        (
            "null",
            selected_document(id, serde_json::Value::Null, serde_json::Value::Null),
            ProjectionIncompleteKind::Missing,
        ),
        (
            "malformed",
            selected_document(
                id,
                serde_json::Value::String("not-base64".to_owned()),
                serde_json::Value::Null,
            ),
            ProjectionIncompleteKind::IncompatibleVersion,
        ),
        (
            "mismatched-key",
            selected_document(
                "00000000-0000-0000-0000-000000000099",
                serde_json::Value::String(document_supplement(id, false)),
                serde_json::Value::Null,
            ),
            ProjectionIncompleteKind::IncompatibleVersion,
        ),
    ] {
        let mutations = authoritative_projection_mutations(
            SUPPLEMENT_SUBSCRIPTION,
            Some("Supplement"),
            &supplement_subscription_data(item),
        )
        .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert!(
            matches!(
                mutations.as_slice(),
                [ProjectionMutation::MarkIncomplete { profile, kind, .. }]
                    if profile == &vocabulary::profile_v3() && *kind == expected_kind
            ),
            "{name}: {mutations:?}"
        );
    }
}

#[test]
fn backfill_rejects_invalid_supplements_and_missing_direct_document_fields() {
    let id = "00000000-0000-0000-0000-000000000001";
    let mut missing_owner = selected_document(
        id,
        serde_json::Value::String(document_supplement(id, false)),
        serde_json::Value::Null,
    );
    missing_owner.as_object_mut().unwrap().remove("ownerId");

    for item in [
        selected_document(id, serde_json::Value::Null, serde_json::Value::Null),
        selected_document(
            id,
            serde_json::Value::String("not-base64".to_owned()),
            serde_json::Value::Null,
        ),
        missing_owner,
    ] {
        let error = authoritative_projection_mutations(
            SUPPLEMENT_BACKFILL,
            Some("SoupBackfill"),
            &serde_json::json!({ "user": { "soup": { "items": [item] } } }),
        )
        .expect_err("an incomplete backfill page must not reach storage");
        assert_eq!(
            error.to_string(),
            "SoupBackfill page contains an incomplete required cache projection"
        );
    }

    let mutations = authoritative_projection_mutations(
        SUPPLEMENT_BACKFILL,
        Some("SoupBackfill"),
        &serde_json::json!({
            "user": { "soup": { "items": [selected_document(
                id,
                serde_json::Value::String(document_supplement(id, false)),
                serde_json::Value::Null,
            )] } }
        }),
    )
    .expect("a complete backfill page is ingestible");
    assert!(matches!(
        mutations.as_slice(),
        [ProjectionMutation::Replace(_)]
    ));
}

#[test]
fn partial_mutation_payloads_patch_v3_without_fabricating_server_facts() {
    let query = r#"mutation PartialRename($inputs: [RenameEntityInput!]!) {
        renameEntities(inputs: $inputs) {
            results {
                __typename
                ... on GraphqlMutationSuccess {
                    effects {
                        __typename
                        ... on SoupUpdated {
                            item {
                                __typename
                                id
                                displayName
                                ... on GraphqlSoupDocument {
                                    ownerId
                                    projectId
                                    fileType
                                    subType { __typename }
                                    updatedAt
                                }
                            }
                        }
                    }
                }
            }
        }
    }"#;
    let data = serde_json::json!({
        "renameEntities": {
            "results": [{
                "__typename": "GraphqlMutationSuccess",
                "effects": [{
                    "__typename": "SoupUpdated",
                    "item": {
                        "__typename": "GraphqlSoupDocument",
                        "id": "00000000-0000-0000-0000-000000000001",
                        "displayName": "Renamed",
                        "ownerId": "macro|new-owner@example.com",
                        "projectId": null,
                        "fileType": "md",
                        "subType": { "__typename": "GraphqlTaskSubType" },
                        "updatedAt": "2026-01-03T00:00:00.000Z"
                    }
                }]
            }]
        }
    });
    let mutations =
        authoritative_projection_mutations(query, Some("PartialRename"), &data).unwrap();
    let [
        ProjectionMutation::Patch {
            profile,
            exact,
            integers,
            sorts,
            ..
        },
    ] = mutations.as_slice()
    else {
        panic!("partial authoritative entity must produce one v3 patch");
    };
    assert_eq!(profile, &vocabulary::profile_v3());
    assert!(
        exact
            .iter()
            .any(|patch| patch.attribute == vocabulary::document_sub_type())
    );
    assert!(
        exact
            .iter()
            .all(|patch| patch.attribute != vocabulary::email_attachment())
    );
    assert!(
        integers
            .iter()
            .any(|patch| patch.attribute == vocabulary::updated_at())
    );
    assert!(
        sorts
            .iter()
            .any(|fact| fact.attribute == vocabulary::updated_at())
    );
}

#[test]
fn invalid_sort_direction_is_rejected_at_the_soup_boundary() {
    let error = compile_filter_request(serde_json::json!({}), "UPDATED_AT", "SIDEWAYS", 10)
        .expect_err("invalid direction must not reach the generic cache");
    assert_eq!(error.to_string(), "invalid entity-filter sort direction");
}

fn production_documents_filters(document_filter: serde_json::Value) -> serde_json::Value {
    const NIL_ID: &str = "00000000-0000-0000-0000-000000000000";
    serde_json::json!({
        "calendarEventFilter": { "literal": { "id": NIL_ID } },
        "documentFilter": document_filter,
        "projectFilter": { "literal": { "projectId": NIL_ID } },
        "chatFilter": { "literal": { "chatId": NIL_ID } },
        "emailFilter": { "tree": { "literal": { "threadId": NIL_ID } } },
        "channelFilter": { "literal": { "channelId": NIL_ID } },
        "channelThreadFilter": { "literal": { "threadId": NIL_ID } },
        "callFilter": { "literal": { "callId": NIL_ID } },
        "crmCompanyFilter": { "literal": { "id": NIL_ID } },
        "foreignEntityFilter": { "literal": { "id": NIL_ID } }
    })
}

fn production_documents_filter_cases() -> Vec<(&'static str, serde_json::Value)> {
    let owner = "macro|phase-0@example.com";
    let not_task = serde_json::json!({
        "not": { "literal": { "subType": "TASK" } }
    });
    let not_task_or_snippet = serde_json::json!({
        "not": {
            "or": {
                "left": { "literal": { "subType": "TASK" } },
                "right": { "literal": { "subType": "SNIPPET" } }
            }
        }
    });
    let attachments = serde_json::json!({ "literal": { "isEmailAttachment": true } });

    vec![
        (
            "owned/snippets-on",
            serde_json::json!({
                "and": {
                    "left": not_task.clone(),
                    "right": {
                        "and": {
                            "left": { "literal": { "owner": owner } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            }),
        ),
        (
            "owned/snippets-off",
            serde_json::json!({
                "and": {
                    "left": not_task_or_snippet.clone(),
                    "right": {
                        "and": {
                            "left": { "literal": { "owner": owner } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            }),
        ),
        (
            "shared/snippets-on",
            serde_json::json!({
                "and": {
                    "left": not_task.clone(),
                    "right": {
                        "and": {
                            "left": { "not": { "literal": { "owner": owner } } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            }),
        ),
        (
            "shared/snippets-off",
            serde_json::json!({
                "and": {
                    "left": not_task_or_snippet.clone(),
                    "right": {
                        "and": {
                            "left": { "not": { "literal": { "owner": owner } } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            }),
        ),
        ("attachments/snippets-on", attachments.clone()),
        ("attachments/snippets-off", attachments),
        ("all/snippets-on", not_task),
        ("all/snippets-off", not_task_or_snippet),
    ]
}

#[test]
fn production_documents_presets_compile_for_created_and_updated_sorts() {
    for (sort_method, sort_attribute) in [
        ("CREATED_AT", vocabulary::created_at()),
        ("UPDATED_AT", vocabulary::updated_at()),
    ] {
        for (sort_direction, direction) in
            [("ASC", SortDirection::Asc), ("DESC", SortDirection::Desc)]
        {
            for (name, document_filter) in production_documents_filter_cases() {
                let outcome = compile_filter_request(
                    production_documents_filters(document_filter),
                    sort_method,
                    sort_direction,
                    100,
                )
                .unwrap_or_else(|error| panic!("{name} should materialize: {error}"));
                let SoupFilterCompileOutcome::Supported(query) = outcome else {
                    panic!("{name} must be soup-flat-v3 eligible");
                };
                assert_eq!(query.as_query().profile, vocabulary::profile_v3(), "{name}");
                assert_eq!(query.as_query().sort_attribute, sort_attribute, "{name}");
                assert_eq!(query.as_query().sort_direction, direction, "{name}");
                assert_eq!(query.as_query().tie_break_direction, direction, "{name}");
            }
        }
    }
}

#[test]
fn production_my_tasks_importance_and_status_filter_compiles_locally() {
    let mut filters = production_documents_filters(serde_json::json!({
        "and": {
            "left": { "literal": { "subType": "TASK" } },
            "right": {
                "or": {
                    "left": { "literal": { "owner": "macro|viewer@example.com" } },
                    "right": { "literal": { "importance": true } }
                }
            }
        }
    }));
    filters.as_object_mut().unwrap().insert(
        "propertiesFilter".to_owned(),
        serde_json::json!({
            "or": {
                "left": {
                    "literal": {
                        "propertyDefinitionId": "00000001-0000-0000-0000-000000000002",
                        "value": {
                            "selectOption": "00000001-0000-0000-0002-000000000001"
                        }
                    }
                },
                "right": {
                    "or": {
                        "left": {
                            "literal": {
                                "propertyDefinitionId": "00000001-0000-0000-0000-000000000002",
                                "value": {
                                    "selectOption": "00000001-0000-0000-0002-000000000002"
                                }
                            }
                        },
                        "right": {
                            "literal": {
                                "propertyDefinitionId": "00000001-0000-0000-0000-000000000002",
                                "value": {
                                    "selectOption": "00000001-0000-0000-0002-000000000003"
                                }
                            }
                        }
                    }
                }
            }
        }),
    );

    let SoupFilterCompileOutcome::Supported(query) =
        compile_filter_request(filters, "UPDATED_AT", "DESC", 100).unwrap()
    else {
        panic!("production My Tasks filter must use the local v3 profile");
    };
    assert_eq!(query.as_query().profile, vocabulary::profile_v3());
    let document = &query.as_query().partitions[0].predicate;
    assert!(format!("{document:?}").contains("importance"));
    assert!(format!("{document:?}").contains("task-status-option"));
}

#[cfg(not(target_arch = "wasm32"))]
fn differential_document(
    id: &str,
    owner: &str,
    is_email_attachment: bool,
    sub_type: Option<&str>,
    sort_value: i64,
) -> IndexDocument {
    let id = uuid::Uuid::parse_str(id).unwrap();
    let mut exact_facts = vec![
        predicate_index::ExactFact {
            attribute: vocabulary::id(),
            value: ExactValue::new(id.as_bytes()).unwrap(),
        },
        predicate_index::ExactFact {
            attribute: vocabulary::owner(),
            value: ExactValue::utf8(owner).unwrap(),
        },
        predicate_index::ExactFact {
            attribute: vocabulary::email_attachment(),
            value: ExactValue::new([u8::from(is_email_attachment)]).unwrap(),
        },
        predicate_index::ExactFact {
            attribute: vocabulary::importance(),
            value: ExactValue::new([1]).unwrap(),
        },
    ];
    if let Some(sub_type) = sub_type {
        exact_facts.push(predicate_index::ExactFact {
            attribute: vocabulary::document_sub_type(),
            value: ExactValue::utf8(sub_type).unwrap(),
        });
    }
    IndexDocument {
        record_key: RecordKey::new(format!("GraphqlSoupDocument:{id}")).unwrap(),
        profile: vocabulary::profile_v3(),
        partition: vocabulary::document_partition(),
        exact_facts,
        integer_facts: vec![
            predicate_index::IntegerFact {
                attribute: vocabulary::created_at(),
                value: sort_value,
            },
            predicate_index::IntegerFact {
                attribute: vocabulary::updated_at(),
                value: sort_value + 100,
            },
        ],
        sort_facts: vec![
            predicate_index::IntegerFact {
                attribute: vocabulary::created_at(),
                value: sort_value,
            },
            predicate_index::IntegerFact {
                attribute: vocabulary::updated_at(),
                value: sort_value + 100,
            },
        ],
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn production_documents_membership_matches_postgres_fixture_reference_and_real_turso() {
    use cache_core::predicate::{PredicateIndexStorage, PredicateQueryResult};
    use cache_core::store::Storage;
    use std::collections::BTreeSet;

    pollster::block_on(async {
        let owner = "macro|phase-0@example.com";
        let documents = vec![
            differential_document(
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                owner,
                true,
                Some("task"),
                1,
            ),
            differential_document(
                "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                owner,
                true,
                Some("task"),
                2,
            ),
            differential_document(
                "dddddddd-dddd-dddd-dddd-dddddddddddd",
                "macro|shared@example.com",
                false,
                None,
                3,
            ),
            differential_document(
                "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
                owner,
                false,
                Some("snippet"),
                4,
            ),
            differential_document(
                "ffffffff-ffff-ffff-ffff-ffffffffffff",
                owner,
                false,
                None,
                5,
            ),
        ];
        let mut storage =
            cache_turso::TursoStorage::open_in_memory("soup-v3-production-shape-differential")
                .unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                documents
                    .iter()
                    .cloned()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();

        let ids = |values: &[&str]| {
            values
                .iter()
                .map(|id| format!("GraphqlSoupDocument:{id}"))
                .collect::<BTreeSet<_>>()
        };
        let expected = BTreeMap::from([
            (
                "owned/snippets-on",
                ids(&[
                    "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
                    "ffffffff-ffff-ffff-ffff-ffffffffffff",
                ]),
            ),
            (
                "owned/snippets-off",
                ids(&["ffffffff-ffff-ffff-ffff-ffffffffffff"]),
            ),
            (
                "shared/snippets-on",
                ids(&["dddddddd-dddd-dddd-dddd-dddddddddddd"]),
            ),
            (
                "shared/snippets-off",
                ids(&["dddddddd-dddd-dddd-dddd-dddddddddddd"]),
            ),
            (
                "attachments/snippets-on",
                ids(&[
                    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                ]),
            ),
            (
                "attachments/snippets-off",
                ids(&[
                    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                ]),
            ),
            (
                "all/snippets-on",
                ids(&[
                    "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
                    "ffffffff-ffff-ffff-ffff-ffffffffffff",
                ]),
            ),
            (
                "all/snippets-off",
                ids(&[
                    "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    "ffffffff-ffff-ffff-ffff-ffffffffffff",
                ]),
            ),
        ]);

        for sort_method in ["CREATED_AT", "UPDATED_AT"] {
            for sort_direction in ["ASC", "DESC"] {
                for (name, filter) in production_documents_filter_cases() {
                    let SoupFilterCompileOutcome::Supported(query) = compile_filter_request(
                        production_documents_filters(filter),
                        sort_method,
                        sort_direction,
                        100,
                    )
                    .unwrap() else {
                        panic!("{name} unexpectedly fell back");
                    };
                    let reference = predicate_index::evaluate_reference(&query, &documents)
                        .into_iter()
                        .map(|hit| hit.record_key.as_str().to_owned())
                        .collect::<Vec<_>>();
                    let PredicateQueryResult::Complete(turso) =
                        storage.query_predicate_index(&query).await.unwrap()
                    else {
                        panic!("{name} Turso scope is incomplete");
                    };
                    let turso = turso
                        .into_iter()
                        .map(|key| key.as_str().to_owned())
                        .collect::<Vec<_>>();
                    assert_eq!(turso, reference, "{name}/{sort_method}/{sort_direction}");
                    assert_eq!(
                        reference.into_iter().collect::<BTreeSet<_>>(),
                        expected[name],
                        "authoritative PostgreSQL fixture membership for {name}"
                    );
                }
            }
        }
    });
}

#[test]
fn production_documents_presets_support_importance_in_v3() {
    let with_unsupported_sibling = serde_json::json!({
        "and": {
            "left": { "literal": { "isEmailAttachment": false } },
            "right": { "literal": { "importance": true } }
        }
    });
    let SoupFilterCompileOutcome::Supported(query) = compile_filter_request(
        production_documents_filters(with_unsupported_sibling),
        "UPDATED_AT",
        "DESC",
        100,
    )
    .unwrap() else {
        panic!("importance must compile in soup-flat-v3");
    };
    assert_eq!(query.as_query().profile, vocabulary::profile_v3());
}

#[derive(Debug, Deserialize)]
struct CapsuleFixtureFile {
    fixture_format: String,
    transport: CapsuleFixtureTransport,
    capsules: Vec<CapsuleFixtureCase>,
}

#[derive(Debug, Deserialize)]
struct CapsuleFixtureTransport {
    base64_variant: String,
    frame: String,
    wire_version: u8,
    max_decoded_bytes: usize,
}

#[derive(Debug, Deserialize)]
struct CapsuleFixtureCase {
    name: String,
    capsule: SemanticCapsuleV1,
    expected_base64: String,
}

#[derive(Debug, Deserialize)]
struct SemanticCapsuleV1 {
    target_profile: String,
    record_key: String,
    partition: String,
    is_email_attachment: bool,
}

#[derive(Debug, Deserialize)]
struct CapsuleFixtureFileV2 {
    fixture_format: String,
    transport: CapsuleFixtureTransport,
    capsules: Vec<CapsuleFixtureCaseV2>,
}

#[derive(Debug, Deserialize)]
struct CapsuleFixtureCaseV2 {
    name: String,
    capsule: SemanticCapsuleV2,
    expected_base64: String,
}

#[derive(Debug, Deserialize)]
struct SemanticCapsuleV2 {
    target_profile: String,
    record_key: String,
    partition: String,
    is_email_attachment: bool,
    is_important: bool,
    status_option_ids: Vec<uuid::Uuid>,
}

#[test]
fn soup_flat_v2_supplement_goldens_lock_typed_server_fact_wire() {
    let fixtures: CapsuleFixtureFile = serde_json::from_str(include_str!(
        "../../soup_filter_projection/testdata/soup-flat-v2-capsules.json"
    ))
    .expect("valid capsule fixture JSON");

    assert_eq!(fixtures.fixture_format, "server-fact-supplement-capsule-v1");
    assert_eq!(fixtures.transport.base64_variant, "RFC4648_STANDARD_NO_PAD");
    assert_eq!(fixtures.transport.frame, "wire-version-byte-plus-postcard");
    assert_eq!(fixtures.transport.wire_version, 1);
    assert_eq!(
        fixtures.transport.max_decoded_bytes,
        soup_filter_projection::MAX_SOUP_CACHE_PROJECTION_BYTES
    );

    for case in fixtures.capsules {
        assert_eq!(case.capsule.target_profile, "soup-flat-v2", "{}", case.name);
        assert_eq!(case.capsule.partition, "document", "{}", case.name);
        assert!(
            !case.expected_base64.is_empty(),
            "{} must lock scalar bytes",
            case.name
        );

        let decoded = decode_cache_projection_supplement(&case.expected_base64)
            .unwrap_or_else(|error| panic!("{} must decode: {error}", case.name));
        assert_eq!(
            decoded.target_profile().token().as_str(),
            case.capsule.target_profile
        );
        assert_eq!(decoded.record_key().as_str(), case.capsule.record_key);
        assert_eq!(decoded.partition().as_str(), case.capsule.partition);
        assert_eq!(
            decoded.is_email_attachment(),
            case.capsule.is_email_attachment
        );
        assert_eq!(
            encode_cache_projection_supplement(&decoded)
                .expect("decoded fixture supplement re-encodes"),
            case.expected_base64,
            "{} scalar bytes",
            case.name
        );
    }
}

#[test]
fn soup_flat_v3_supplement_goldens_lock_viewer_relative_wire() {
    let fixtures: CapsuleFixtureFileV2 = serde_json::from_str(include_str!(
        "../../soup_filter_projection/testdata/soup-flat-v3-capsules.json"
    ))
    .expect("valid capsule fixture JSON");

    assert_eq!(fixtures.fixture_format, "server-fact-supplement-capsule-v2");
    assert_eq!(fixtures.transport.base64_variant, "RFC4648_STANDARD_NO_PAD");
    assert_eq!(fixtures.transport.frame, "wire-version-byte-plus-postcard");
    assert_eq!(fixtures.transport.wire_version, 2);
    assert_eq!(
        fixtures.transport.max_decoded_bytes,
        soup_filter_projection::MAX_SOUP_CACHE_PROJECTION_BYTES
    );

    for case in fixtures.capsules {
        let decoded = decode_cache_projection_supplement(&case.expected_base64)
            .unwrap_or_else(|error| panic!("{} must decode: {error}", case.name));
        assert_eq!(
            decoded.target_profile().token().as_str(),
            case.capsule.target_profile
        );
        assert_eq!(decoded.record_key().as_str(), case.capsule.record_key);
        assert_eq!(decoded.partition().as_str(), case.capsule.partition);
        assert_eq!(
            decoded.is_email_attachment(),
            case.capsule.is_email_attachment
        );
        assert_eq!(decoded.is_important(), Some(case.capsule.is_important));
        assert_eq!(
            decoded.status_option_ids(),
            Some(case.capsule.status_option_ids.as_slice())
        );
        assert_eq!(
            encode_cache_projection_supplement(&decoded).unwrap(),
            case.expected_base64,
            "{} scalar bytes",
            case.name
        );
    }
}
