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
        exact,
        integers,
        sorts,
        ..
    } = &mutations[0]
    else {
        panic!("partial optimistic Soup entity should compile to a patch");
    };
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
    assert!(matches!(
        complete.as_slice(),
        [OptimisticProjectionMutation::Replace(_)]
    ));

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
    let mutations = authoritative_projection_mutations(&serde_json::json!({
        "item": {
            "__typename": "GraphqlSoupDocument",
            "id": "00000000-0000-0000-0000-000000000001",
            "ownerId": "user-1",
            "projectId": null,
            "fileType": "md",
            "createdAt": "2025-01-01T00:00:00.000001Z",
            "updatedAt": "2025-01-02T00:00:00.000001Z"
        }
    }));
    assert!(matches!(
        mutations.as_slice(),
        [ProjectionMutation::Replace(_)]
    ));
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

#[test]
fn production_documents_presets_are_characterized_as_unsupported_in_v1() {
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

    let cases = [
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
        (
            "attachments",
            serde_json::json!({ "literal": { "isEmailAttachment": true } }),
        ),
        ("all/snippets-on", not_task),
        ("all/snippets-off", not_task_or_snippet),
    ];

    for (name, document_filter) in cases {
        let outcome = compile_filter_request(
            production_documents_filters(document_filter),
            "UPDATED_AT",
            "DESC",
            100,
        )
        .unwrap_or_else(|error| panic!("{name} should materialize: {error}"));
        assert!(
            matches!(outcome, SoupFilterCompileOutcome::Unsupported),
            "{name} unexpectedly became soup-flat-v1 eligible"
        );
    }
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
