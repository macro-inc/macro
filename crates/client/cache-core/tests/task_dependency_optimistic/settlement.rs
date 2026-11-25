//! First assignment settlement without explicit identity bindings.

use super::*;
use cache_core::link_patch::QueryRevalidation;
use cache_core::value::EntityKey;

const PARENT_QUERY: &str = "{ user { id soupEntity(input: {}) { __typename id ... on GraphqlSoupDocument { properties { id propertyDefinitionId } } } } }";
const UUID: &str = "11111111-1111-4111-8111-111111111111";

async fn parent_properties(engine: &mut Engine<InMemoryStorage>) -> Value {
    let ReadResult::Hit { data } = engine
        .read_query(None, PARENT_QUERY, None, &Map::new())
        .await
        .unwrap()
    else {
        panic!("parent remains readable")
    };
    data["user"]["soupEntity"]["properties"].clone()
}

async fn first_assignment() -> (Engine<InMemoryStorage>, u64, QueryRevalidation) {
    let mut engine = Engine::new(InMemoryStorage::new());
    seed(
        &mut engine,
        vec![state("a", &[], &[]), state("b", &[], &[])],
    )
    .await;
    engine
        .write_query(
            None,
            PARENT_QUERY,
            None,
            &Map::new(),
            &json!({"user":{"id":"viewer","soupEntity":{"__typename":"GraphqlSoupDocument","id":"a","properties":[]}}}),
            None,
        )
        .await
        .unwrap();
    let repair = QueryRevalidation {
        query: PARENT_QUERY.into(),
        operation_name: None,
        variables_json: "{}".into(),
        only_on_link_failure: true,
    };
    let id = engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                task_dependency_recipe: Some(&TaskDependencyRecipe {
                    task_id: "a".into(),
                    change: TaskDependencyChange::DependsOn {
                        target_ids: vec!["b".into()],
                    },
                }),
                client_metadata: None,
                identity_bindings: &[],
                uuid: UUID,
                query: MUTATION,
                operation_name: Some("SetTaskProperty"),
                variables: &variables(),
                data: &json!({"setTaskProperty":{"property":property("local", DEPENDS, &["b"])}}),
                link_patches: &[assignment_link("a", "local")],
                revalidations: std::slice::from_ref(&repair),
                created_at_ms: 0,
            },
        )
        .await
        .unwrap()
        .0;
    (engine, id, repair)
}

async fn claim(engine: &mut Engine<InMemoryStorage>) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 1,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "test".into(),
        generation: claimed.lease_generation,
    }
}

#[test]
fn first_assignment_without_bindings_settles_states_and_requests_parent_repair() {
    block_on(async {
        let (mut engine, id, repair) = first_assignment().await;
        for reload in [false, true] {
            if reload {
                engine = Engine::new(engine.into_storage());
            }
            let queue = engine.storage().load_mutation_queue().await.unwrap();
            assert_eq!(queue.len(), 1);
            let envelope = queue[0]
                .optimistic
                .optimistic_data_json
                .strip_prefix("@macro-cache/optimistic-source:")
                .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(envelope).unwrap()["version"],
                3
            );
            let source =
                decode_optimistic_source(&queue[0].optimistic.optimistic_data_json).unwrap();
            assert_eq!(source.identity_bindings, vec![]);
            assert!(
                source.mutation_data["setTaskProperty"]
                    .get("tasks")
                    .is_none()
            );
            assert_eq!(source.link_patches, vec![assignment_link("a", "local")]);
            assert_eq!(source.revalidations, vec![repair.clone()]);
        }
        assert_eq!(parent_properties(&mut engine).await[0]["id"], "local");
        let optimistic = tasks(&mut engine).await;
        assert_eq!(links(&optimistic[0], DEPENDS), vec!["b"]);
        assert_eq!(links(&optimistic[1], BLOCKING), vec!["a"]);

        let token = claim(&mut engine).await;
        let result = engine
            .commit_optimistic_write(
                id,
                token,
                MUTATION,
                Some("SetTaskProperty"),
                &variables(),
                &json!({"setTaskProperty":{
                    "property":property("canonical", DEPENDS, &["b"]),
                    "tasks":[
                        {"__typename":"GraphqlTaskDependencyState","id":"a","isBlocked":true,
                         "visibleBlockerIds":["b"],"openBlockerIds":["b"],
                         "properties":[property("canonical", DEPENDS, &["b"]), property("a-blocking", BLOCKING, &[])]},
                        state("b", &[], &["a"])["taskDependencies"].clone()
                    ],
                    "effectsComplete":true
                }}),
            )
            .await
            .unwrap();
        assert!(result.identity_errors.is_empty());
        assert_eq!(result.revalidations, vec![repair]);
        for reload in [false, true] {
            if reload {
                engine = Engine::new(engine.into_storage());
            }
            assert!(
                engine
                    .storage()
                    .load_mutation_queue()
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(parent_properties(&mut engine).await, json!([]));
            let authoritative = tasks(&mut engine).await;
            assert_eq!(links(&authoritative[0], DEPENDS), vec!["b"]);
            assert_eq!(authoritative[0]["taskDependencies"]["isBlocked"], true);
            assert_eq!(
                authoritative[0]["taskDependencies"]["visibleBlockerIds"],
                json!(["b"])
            );
            assert_eq!(
                authoritative[0]["taskDependencies"]["openBlockerIds"],
                json!(["b"])
            );
            assert_eq!(links(&authoritative[1], BLOCKING), vec!["a"]);
            assert!(
                engine
                    .storage()
                    .get_batch(&[EntityKey::entity("GraphqlProperty", &["canonical"])])
                    .await
                    .unwrap()[0]
                    .is_some()
            );
        }
        let authoritative = tasks(&mut engine).await;
        engine
            .write_query(
                None,
                PARENT_QUERY,
                None,
                &Map::new(),
                &json!({"user":{"id":"viewer","soupEntity":{"__typename":"GraphqlSoupDocument","id":"a","properties":[property("canonical", DEPENDS, &["b"])]}}}),
                None,
            )
            .await
            .unwrap();
        for reload in [false, true] {
            if reload {
                engine = Engine::new(engine.into_storage());
            }
            assert_eq!(
                parent_properties(&mut engine).await,
                json!([{"id":"canonical","propertyDefinitionId":DEPENDS}])
            );
            assert_eq!(tasks(&mut engine).await, authoritative);
            assert!(
                engine
                    .storage()
                    .load_mutation_queue()
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    });
}

#[test]
fn first_assignment_without_bindings_links_unique_response_directly() {
    block_on(async {
        let (mut engine, id, _) = first_assignment().await;
        let mut b = state("b", &[], &["a"])["taskDependencies"].clone();
        b["properties"] = json!([property("b-blocking", BLOCKING, &["a"])]);
        let claim = claim(&mut engine).await;
        let result = engine
            .commit_optimistic_write(
                id,
                claim,
                MUTATION,
                Some("SetTaskProperty"),
                &variables(),
                &json!({"setTaskProperty":{
                    "property":property("canonical", DEPENDS, &["b"]),
                    "tasks":[
                        {"__typename":"GraphqlTaskDependencyState","id":"a","isBlocked":true,
                         "visibleBlockerIds":["b"],"openBlockerIds":["b"],
                         "properties":[property("canonical", DEPENDS, &["b"]), property("a-blocking", BLOCKING, &[])]},
                        b
                    ],
                    "effectsComplete":true
                }}),
            )
            .await
            .unwrap();
        assert!(result.identity_errors.is_empty());
        assert!(result.revalidations.is_empty());
        for reload in [false, true] {
            if reload {
                engine = Engine::new(engine.into_storage());
            }
            assert_eq!(
                parent_properties(&mut engine).await,
                json!([{"id":"canonical","propertyDefinitionId":DEPENDS}])
            );
            assert_eq!(links(&tasks(&mut engine).await[0], DEPENDS), vec!["b"]);
            assert_eq!(links(&tasks(&mut engine).await[1], BLOCKING), vec!["a"]);
            assert!(
                engine
                    .storage()
                    .load_mutation_queue()
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    });
}
