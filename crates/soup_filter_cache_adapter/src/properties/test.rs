use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, Engine, InitialClaimOutcome, NetworkWrite},
    predicate::PredicateIndexStorage,
    queue::{MutationClaimRequest, MutationClaimToken},
    store::{InMemoryStorage, Storage},
};
use serde_json::json;
use uuid::Uuid;

const QUERY: &str = include_str!("test/project.graphql");
const SET: &str = include_str!("test/set.graphql");
const VIEWER: &str = "macro|properties@example.com";
fn id(n: u128) -> String {
    Uuid::from_u128(n).to_string()
}
fn key() -> RecordKey {
    RecordKey::new(format!("GraphqlSoupProject:{}", id(100))).unwrap()
}
fn property(n: u128, option: u128) -> Value {
    json!({"id": id(n + 1000), "propertyDefinitionId": id(n), "value": {"__typename":"GraphqlSelectOptionPropertyValue", "optionIds": [id(option)]}})
}
fn data() -> Value {
    json!({"user": {"id": VIEWER, "soup": {"items": [{
        "__typename": "GraphqlSoupProject", "id": id(100), "cacheProjection": null,
        "ownerId": VIEWER, "parentId": null, "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-02T00:00:00Z", "notifications": [],
        "properties": [property(1, 11), property(2, 22)],
    }]}}})
}
fn filters(property: Option<Value>) -> Value {
    let nil = id(0);
    let mut filters = json!({
        "documentFilter":{"literal":{"id":nil}}, "projectFilter":{"literal":{"projectIdSelf": id(100)}},
        "chatFilter":{"literal":{"chatId":nil}}, "emailFilter":{"tree":{"literal":{"threadId":nil}}},
        "channelFilter":{"literal":{"channelId":nil}}, "channelThreadFilter":{"literal":{"threadId":nil}},
        "calendarEventFilter":{"literal":{"id":nil}}, "callFilter":{"literal":{"callId":nil}},
        "crmCompanyFilter":{"literal":{"id":nil}}, "foreignEntityFilter":{"literal":{"id":nil}},
    });
    if let Some(property) = property {
        filters["propertiesFilter"] = property;
    }
    filters
}
fn literal(definition: u128, option: u128) -> Value {
    json!({"literal":{"propertyDefinitionId": id(definition), "value":{"selectOption":id(option)}}})
}
async fn write<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    query: &str,
    vars: &Map<String, Value>,
    data: &Value,
    identity: &str,
) {
    let core = crate::authoritative_projection_mutations(query, None, data).unwrap();
    let reuse = engine
        .current_identity()
        .await
        .unwrap()
        .as_deref()
        .is_none_or(|bound| bound == identity);
    let projections = augment_authoritative(engine.storage(), query, None, vars, data, reuse, core)
        .await
        .unwrap();
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query,
                operation_name: None,
                variables: vars,
                data,
                identity: Some(identity),
            },
            projections,
        )
        .await
        .unwrap();
}
async fn matches<S: PredicateIndexStorage>(engine: &mut Engine<S>, property: Value) -> bool {
    let crate::SoupFilterCompileOutcome::Supported(query) =
        crate::compile_current_filter_request(filters(Some(property)), "UPDATED_AT", "DESC", 100)
            .unwrap()
    else {
        panic!("filter must be supported")
    };
    engine
        .reconcile_predicate_index(&query, &[])
        .await
        .unwrap()
        .value
        .keys
        == vec![key()]
}

#[test]
fn property_snapshots_and_single_property_writes_update_native_postings() {
    pollster::block_on(async {
        let mut engine =
            Engine::new(cache_turso::TursoStorage::open_in_memory("properties").unwrap());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        assert!(matches(&mut engine, literal(1, 11)).await);
        assert!(!matches(&mut engine, literal(1, 12)).await);
        let vars = json!({"input": {"entityType":"PROJECT", "entityId":id(100), "propertyDefinitionId":id(1)}}).as_object().unwrap().clone();
        write(
            &mut engine,
            SET,
            &vars,
            &json!({"setEntityProperty":property(1,12)}),
            VIEWER,
        )
        .await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,12),"right":literal(2,22)}})
            )
            .await
        );
    });
}

#[test]
fn missing_or_malformed_property_proof_is_unknown_not_a_negative_match() {
    pollster::block_on(async {
        for properties in [None, Some(Value::Null), Some(json!([{"id":id(1)}]))] {
            let mut payload = data();
            let row = payload["user"]["soup"]["items"][0].as_object_mut().unwrap();
            row.remove("properties");
            if let Some(properties) = properties {
                row.insert("properties".into(), properties);
            }
            let mut engine = Engine::new(InMemoryStorage::new());
            write(&mut engine, QUERY, &Map::new(), &payload, VIEWER).await;
            let state = engine
                .storage()
                .load_projection_states(&[key()])
                .await
                .unwrap()
                .pop()
                .flatten()
                .unwrap();
            assert!(matches!(state, ProjectionState::Incomplete { .. }));
            assert!(!matches(&mut engine, json!({"not":literal(1,11)})).await);
        }
    });
}

#[test]
fn empty_snapshots_clear_facts_but_deleted_child_records_make_them_unknown() {
    pollster::block_on(async {
        let mut engine =
            Engine::new(cache_turso::TursoStorage::open_in_memory("property-deletion").unwrap());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let changes =
            deletion_updates(engine.storage(), &[format!("GraphqlProperty:{}", id(1001))])
                .await
                .unwrap();
        assert_eq!(changes.len(), 1);
        assert!(matches!(
            changes[0],
            ProjectionMutation::MarkIncomplete { .. }
        ));
        let mut payload = data();
        payload["user"]["soup"]["items"][0]["properties"] = json!([]);
        write(&mut engine, QUERY, &Map::new(), &payload, VIEWER).await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(matches(&mut engine, json!({"not":literal(1,11)})).await);
    });
}

#[test]
fn identity_changes_never_borrow_older_property_snapshots() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let mut payload = data();
        payload["user"]["id"] = json!("macro|other@example.com");
        payload["user"]["soup"]["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("properties");
        write(
            &mut engine,
            QUERY,
            &Map::new(),
            &payload,
            "macro|other@example.com",
        )
        .await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(!matches(&mut engine, json!({"not":literal(1,11)})).await);
    });
}

#[test]
fn independent_property_optimism_survives_rollback_and_commits() {
    pollster::block_on(async {
        let mut engine =
            Engine::new(cache_turso::TursoStorage::open_in_memory("property-queue").unwrap());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let mut first = None;
        let mut second_data = Value::Null;
        let mut second_vars = Map::new();
        for (definition, option) in [(1, 12), (2, 23)] {
            let vars = json!({"input":{"entityType":"PROJECT","entityId":id(100),"propertyDefinitionId":id(definition)}}).as_object().unwrap().clone();
            let data = json!({"setEntityProperty":property(definition, option)});
            let projections = augment_optimistic(engine.storage(), SET, None, &vars, &data, vec![])
                .await
                .unwrap();
            let uuid = format!("00000000-0000-7000-8000-{definition:012}");
            let queued = engine
                .enqueue_optimistic_mutation_with_projections(
                    None,
                    BeginOptimisticWrite {
                        uuid: &uuid,
                        query: SET,
                        operation_name: None,
                        variables: &vars,
                        data: &data,
                        link_patches: &[],
                        revalidations: &[],
                        created_at_ms: 0,
                    },
                    MutationClaimRequest {
                        owner: "runner".into(),
                        now_ms: 0,
                        lease_expires_at_ms: 1000,
                    },
                    projections,
                )
                .await
                .unwrap();
            if definition == 1 {
                first = Some(queued);
            } else {
                second_data = data;
                second_vars = vars;
            }
        }
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,12),"right":literal(2,23)}})
            )
            .await
        );
        let first = first.unwrap();
        let InitialClaimOutcome::Claimed(claim) = first.initial_claim else {
            panic!("first claim")
        };
        engine
            .rollback_optimistic_write(
                first.transaction_id,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,11),"right":literal(2,23)}})
            )
            .await
        );
        assert!(!matches(&mut engine, literal(1, 12)).await);
        let claim = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 1000,
            })
            .await
            .unwrap()
            .unwrap();
        let projections = augment_authoritative(
            engine.storage(),
            SET,
            None,
            &second_vars,
            &second_data,
            true,
            vec![],
        )
        .await
        .unwrap();
        engine
            .commit_optimistic_write_with_projections_outcome(
                claim.queued.id,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claim.lease_generation,
                },
                SET,
                None,
                &second_vars,
                &second_data,
                projections,
            )
            .await
            .unwrap();
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,11),"right":literal(2,23)}})
            )
            .await
        );
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn id_only_property_mutation_responses_invalidate_old_value_proof() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let vars = json!({"input":{"entityType":"PROJECT","entityId":id(100),"propertyDefinitionId":id(1)}}).as_object().unwrap().clone();
        write(&mut engine, "mutation Set($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { id } }", &vars,
            &json!({"setEntityProperty":{"id":id(1001)}}), VIEWER).await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(!matches(&mut engine, json!({"not":literal(1,11)})).await);
    });
}

#[test]
fn property_optimism_only_patches_the_modified_definition() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let vars = json!({"input": {"entityType":"PROJECT", "entityId":id(100), "propertyDefinitionId":id(1)}}).as_object().unwrap().clone();
        let changes = augment_optimistic(
            engine.storage(),
            SET,
            None,
            &vars,
            &json!({"setEntityProperty":property(1,12)}),
            vec![],
        )
        .await
        .unwrap();
        let [OptimisticProjectionMutation::Patch { exact, profile, .. }] = changes.as_slice()
        else {
            panic!("property patch expected")
        };
        assert_eq!(profile, &vocabulary::profile_v5());
        assert_eq!(exact.len(), 3);
        assert!(
            exact
                .iter()
                .all(|patch| patch.attribute.as_str().contains(&id(1)))
        );
    });
}
