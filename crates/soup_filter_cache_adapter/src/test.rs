use serde::Deserialize;
use soup_filter_projection::{
    decode_cache_projection_supplement, encode_cache_projection_supplement,
};

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
    assert_eq!(profile, &vocabulary::profile_v2());
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
        panic!("a document create without an attachment fact must patch, not claim completeness");
    };
    assert_eq!(profile, &vocabulary::profile_v2());
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
        panic!("a project optimistic create has every required v2 fact");
    };
    assert_eq!(complete.profile, vocabulary::profile_v2());

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
fn authoritative_direct_fields_do_not_require_a_projection_schema_field() {
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
        [ProjectionMutation::Replace(_)]
    ));
}

const ORDINARY_DOCUMENT_CAPSULE: &str = "AQxzb3VwLWZsYXQtdjI4R3JhcGhxbFNvdXBEb2N1bWVudDowMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEIZG9jdW1lbnQEEGVtYWlsLWF0dGFjaG1lbnQBAAlmaWxlLXR5cGUCbWQCaWQQAAAAAAAAAAAAAAAAAAAAAQVvd25lchdtYWNyb3xvd25lckBleGFtcGxlLmNvbQIKY3JlYXRlZC1hdICAguKI0qMGCnVwZGF0ZWQtYXSAgL2/jNejBgIKY3JlYXRlZC1hdICAguKI0qMGCnVwZGF0ZWQtYXSAgL2/jNejBg";

const CAPSULE_SUBSCRIPTION: &str = r#"subscription Capsule {
    soupUpdates {
        __typename
        ... on SoupUpdated {
            item {
                __typename
                id
                cacheProjection @cacheOnly
            }
        }
    }
}"#;

const CAPSULE_BACKFILL: &str = r#"query SoupBackfill {
    user {
        soup(input: { initial: { limit: 1 } }) {
            items {
                __typename
                id
                cacheProjection @cacheOnly
            }
        }
    }
}"#;

fn capsule_subscription_data(id: &str, capsule: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "soupUpdates": [{
            "__typename": "SoupUpdated",
            "item": {
                "__typename": "GraphqlSoupDocument",
                "id": id,
                "cacheProjection": capsule
            }
        }]
    })
}

#[test]
fn selected_capsules_replace_v2_and_bind_to_the_surrounding_entity() {
    let batch = authoritative_projection_batch(
        CAPSULE_SUBSCRIPTION,
        Some("Capsule"),
        &capsule_subscription_data(
            "00000000-0000-0000-0000-000000000001",
            serde_json::Value::String(ORDINARY_DOCUMENT_CAPSULE.to_owned()),
        ),
    )
    .unwrap();
    let [ProjectionMutation::Replace(document)] = batch.mutations.as_slice() else {
        panic!("valid selected capsule must replace authority");
    };
    assert_eq!(document.profile, vocabulary::profile_v2());
    assert_eq!(document.partition, vocabulary::document_partition());
    let telemetry = batch.telemetry.expect("selected capsule is observable");
    assert_eq!(telemetry.operation, "other");
    assert_eq!(telemetry.requested_count, 1);
    assert_eq!(telemetry.present_count, 1);
    assert_eq!(telemetry.complete_count, 1);
    assert_eq!(telemetry.capsule_count, 1);
    assert_eq!(
        telemetry.capsule_bytes,
        u64::try_from(ORDINARY_DOCUMENT_CAPSULE.len()).unwrap()
    );
    assert_eq!(telemetry.fact_count, 8);

    for (name, data, expected_kind) in [
        (
            "absent",
            serde_json::json!({
                "soupUpdates": [{
                    "__typename": "SoupUpdated",
                    "item": {
                        "__typename": "GraphqlSoupDocument",
                        "id": "00000000-0000-0000-0000-000000000001"
                    }
                }]
            }),
            ProjectionIncompleteKind::Missing,
        ),
        (
            "null",
            capsule_subscription_data(
                "00000000-0000-0000-0000-000000000001",
                serde_json::Value::Null,
            ),
            ProjectionIncompleteKind::Missing,
        ),
        (
            "malformed",
            capsule_subscription_data(
                "00000000-0000-0000-0000-000000000001",
                serde_json::Value::String("not-base64".to_owned()),
            ),
            ProjectionIncompleteKind::IncompatibleVersion,
        ),
        (
            "mismatched-key",
            capsule_subscription_data(
                "00000000-0000-0000-0000-000000000099",
                serde_json::Value::String(ORDINARY_DOCUMENT_CAPSULE.to_owned()),
            ),
            ProjectionIncompleteKind::IncompatibleVersion,
        ),
    ] {
        let mutations =
            authoritative_projection_mutations(CAPSULE_SUBSCRIPTION, Some("Capsule"), &data)
                .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert!(
            matches!(
                mutations.as_slice(),
                [ProjectionMutation::MarkIncomplete { profile, kind, .. }]
                    if profile == &vocabulary::profile_v2() && *kind == expected_kind
            ),
            "{name}: {mutations:?}"
        );
    }
}

#[test]
fn backfill_rejects_incomplete_capsules_before_planning_any_write() {
    let data = |cache_projection: serde_json::Value| {
        serde_json::json!({
            "user": {
                "soup": {
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": "00000000-0000-0000-0000-000000000001",
                        "cacheProjection": cache_projection
                    }]
                }
            }
        })
    };

    for value in [
        serde_json::Value::Null,
        serde_json::Value::String("not-base64".to_owned()),
    ] {
        let error =
            authoritative_projection_batch(CAPSULE_BACKFILL, Some("SoupBackfill"), &data(value))
                .expect_err("an incomplete backfill page must not reach storage");
        assert_eq!(
            error.to_string(),
            "SoupBackfill page contains an incomplete required cache projection"
        );
    }

    let batch = authoritative_projection_batch(
        CAPSULE_BACKFILL,
        Some("SoupBackfill"),
        &data(serde_json::Value::String(
            ORDINARY_DOCUMENT_CAPSULE.to_owned(),
        )),
    )
    .expect("a complete backfill page is ingestible");
    assert!(matches!(
        batch.mutations.as_slice(),
        [ProjectionMutation::Replace(_)]
    ));
    assert_eq!(batch.telemetry.unwrap().operation, "backfill");
}

#[test]
fn partial_mutation_payloads_patch_v2_without_fabricating_relation_facts() {
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
        panic!("partial authoritative entity must produce one v2 patch");
    };
    assert_eq!(profile, &vocabulary::profile_v2());
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
                    panic!("{name} must be soup-flat-v2 eligible");
                };
                assert_eq!(query.as_query().profile, vocabulary::profile_v2(), "{name}");
                assert_eq!(query.as_query().sort_attribute, sort_attribute, "{name}");
                assert_eq!(query.as_query().sort_direction, direction, "{name}");
                assert_eq!(query.as_query().tie_break_direction, direction, "{name}");
            }
        }
    }
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
    ];
    if let Some(sub_type) = sub_type {
        exact_facts.push(predicate_index::ExactFact {
            attribute: vocabulary::document_sub_type(),
            value: ExactValue::utf8(sub_type).unwrap(),
        });
    }
    IndexDocument {
        record_key: RecordKey::new(format!("GraphqlSoupDocument:{id}")).unwrap(),
        profile: vocabulary::profile_v2(),
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
            cache_turso::TursoStorage::open_in_memory("soup-v2-production-shape-differential")
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
fn production_documents_presets_keep_unsupported_siblings_all_or_network() {
    let with_unsupported_sibling = serde_json::json!({
        "and": {
            "left": { "literal": { "isEmailAttachment": false } },
            "right": { "literal": { "importance": true } }
        }
    });
    assert!(matches!(
        compile_filter_request(
            production_documents_filters(with_unsupported_sibling),
            "UPDATED_AT",
            "DESC",
            100,
        )
        .unwrap(),
        SoupFilterCompileOutcome::Unsupported(_)
    ));
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
