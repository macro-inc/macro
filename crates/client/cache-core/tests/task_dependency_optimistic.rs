//! Real-engine task recipes rebase across rejection, replacement, and retirement.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken, decode_optimistic_source};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::task_dependency::{TaskDependencyChange, TaskDependencyRecipe};
use pollster::block_on;
use serde_json::{Map, Value, json};

const DEPENDS: &str = "00000001-0000-0000-0000-000000000007";
const BLOCKING: &str = "00000001-0000-0000-0000-000000000015";
const STATUS: &str = "00000001-0000-0000-0000-000000000002";
const COMPLETED: &str = "00000001-0000-0000-0002-000000000004";
const MUTATION: &str = concat!(
    include_str!(
        "../../../../apps/web/src/lib/service-clients/service-storage/graphql/task-dependencies.graphql"
    ),
    r#"fragment SoupPropertyFields on GraphqlProperty {
        id propertyDefinitionId value { __typename
            ... on GraphqlEntityReferencePropertyValue { references { entityId entityType } }
            ... on GraphqlSelectOptionPropertyValue { optionIds }
        }
    }"#
);
const QUERY: &str = r#"query Tasks($input: SoupInput!) {
 user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument {
 taskDependencies { __typename id isBlocked openBlockerIds properties { id propertyDefinitionId value { __typename
 ... on GraphqlEntityReferencePropertyValue { references { entityId entityType } }
 ... on GraphqlSelectOptionPropertyValue { optionIds } } } }
 } } } }
}"#;

fn property(id: &str, definition: &str, targets: &[&str]) -> Value {
    json!({"id":id,"propertyDefinitionId":definition,"value":if targets.is_empty() { Value::Null } else { json!({
        "__typename":"GraphqlEntityReferencePropertyValue", "references":targets.iter().map(|id| json!({"entityId":id,"entityType":"TASK"})).collect::<Vec<_>>()
    }) }})
}

fn state(id: &str, blockers: &[&str], dependents: &[&str]) -> Value {
    json!({"__typename":"GraphqlSoupDocument","id":id,"taskDependencies":{
        "__typename":"GraphqlTaskDependencyState","id":id,"isBlocked":!blockers.is_empty(),"openBlockerIds":blockers,
        "properties":[property(&format!("{id}-depends"), DEPENDS, blockers), property(&format!("{id}-blocking"), BLOCKING, dependents)]
    }})
}

fn variables() -> Map<String, Value> {
    json!({"input":{}}).as_object().unwrap().clone()
}

async fn seed(engine: &mut Engine<InMemoryStorage>, items: Vec<Value>) {
    engine
        .write_query(
            None,
            QUERY,
            Some("Tasks"),
            &variables(),
            &json!({"user":{"id":"viewer","soup":{"items":items}}}),
            None,
        )
        .await
        .unwrap();
}

async fn assign(
    engine: &mut Engine<InMemoryStorage>,
    task: &str,
    uuid: &str,
    property: Value,
    change: TaskDependencyChange,
) -> u64 {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                task_dependency_recipe: Some(&TaskDependencyRecipe {
                    task_id: task.into(),
                    change,
                }),
                client_metadata: None,
                identity_bindings: &[],
                uuid,
                query: MUTATION,
                operation_name: Some("SetTaskProperty"),
                variables: &variables(),
                data: &json!({"setTaskProperty":{"property":property}}),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
            },
        )
        .await
        .unwrap()
        .0
}

async fn tasks(engine: &mut Engine<InMemoryStorage>) -> Vec<Value> {
    let ReadResult::Hit { data } = engine
        .read_query(None, QUERY, Some("Tasks"), &variables())
        .await
        .unwrap()
    else {
        panic!("tasks remain readable")
    };
    data["user"]["soup"]["items"].as_array().unwrap().clone()
}

async fn reject(engine: &mut Engine<InMemoryStorage>, id: u64) {
    let claim = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 1,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    engine
        .rollback_optimistic_write(
            id,
            MutationClaimToken {
                owner: "test".into(),
                generation: claim.lease_generation,
            },
        )
        .await
        .unwrap();
}

fn links(task: &Value, definition: &str) -> Vec<String> {
    let property = task["taskDependencies"]["properties"]
        .as_array()
        .unwrap()
        .iter()
        .find(|property| property["propertyDefinitionId"] == definition)
        .unwrap();
    property["value"]["references"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|reference| reference["entityId"].as_str().unwrap().into())
        .collect()
}

#[test]
fn overlapping_rejection_rebases_immediately_and_after_engine_replacement() {
    block_on(async {
        for reload in [false, true] {
            let mut engine = Engine::new(InMemoryStorage::new());
            seed(
                &mut engine,
                vec![
                    state("a", &[], &[]),
                    state("b", &[], &[]),
                    state("c", &[], &[]),
                ],
            )
            .await;
            let a = assign(
                &mut engine,
                "a",
                "11111111-1111-4111-8111-111111111111",
                property("a-depends", DEPENDS, &["b"]),
                TaskDependencyChange::DependsOn {
                    target_ids: vec!["b".into()],
                },
            )
            .await;
            assign(
                &mut engine,
                "c",
                "22222222-2222-4222-8222-222222222222",
                property("c-depends", DEPENDS, &["b"]),
                TaskDependencyChange::DependsOn {
                    target_ids: vec!["b".into()],
                },
            )
            .await;
            assert_eq!(
                links(&tasks(&mut engine).await[1], BLOCKING),
                vec!["a", "c"]
            );
            let queue = engine.storage().load_mutation_queue().await.unwrap();
            let source =
                decode_optimistic_source(&queue[1].optimistic.optimistic_data_json).unwrap();
            assert!(
                source.mutation_data["setTaskProperty"]
                    .get("tasks")
                    .is_none()
            );
            if reload {
                engine = Engine::new(engine.into_storage());
            }
            reject(&mut engine, a).await;
            let visible = tasks(&mut engine).await;
            assert_eq!(links(&visible[1], BLOCKING), vec!["c"]);
            assert_eq!(visible[0]["taskDependencies"]["isBlocked"], false);
            assert_eq!(visible[2]["taskDependencies"]["isBlocked"], true);
            assert_eq!(
                visible[2]["taskDependencies"]["openBlockerIds"],
                json!(["b"])
            );
        }
    });
}

#[test]
fn committed_base_changes_rebase_pending_reciprocal_assignments() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(
            &mut engine,
            vec![
                state("a", &[], &[]),
                state("b", &[], &[]),
                state("c", &[], &[]),
            ],
        )
        .await;
        let a = assign(
            &mut engine,
            "a",
            "11111111-1111-4111-8111-111111111111",
            property("a-depends", DEPENDS, &["b"]),
            TaskDependencyChange::DependsOn {
                target_ids: vec!["b".into()],
            },
        )
        .await;
        assign(
            &mut engine,
            "c",
            "22222222-2222-4222-8222-222222222222",
            property("c-depends", DEPENDS, &["b"]),
            TaskDependencyChange::DependsOn {
                target_ids: vec!["b".into()],
            },
        )
        .await;
        seed(
            &mut engine,
            vec![
                state("a", &[], &[]),
                state("b", &[], &["d"]),
                state("c", &[], &[]),
            ],
        )
        .await;
        assert_eq!(
            links(&tasks(&mut engine).await[1], BLOCKING),
            vec!["d", "a", "c"]
        );
        reject(&mut engine, a).await;
        assert_eq!(
            links(&tasks(&mut engine).await[1], BLOCKING),
            vec!["d", "c"]
        );
        let mut engine = Engine::new(engine.into_storage());
        assert_eq!(
            links(&tasks(&mut engine).await[1], BLOCKING),
            vec!["d", "c"]
        );
    });
}

#[test]
fn removing_a_dependency_reads_old_membership_before_normalizing_the_property() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(
            &mut engine,
            vec![state("a", &["b"], &[]), state("b", &[], &["a"])],
        )
        .await;
        let id = assign(
            &mut engine,
            "a",
            "11111111-1111-4111-8111-111111111111",
            property("a-depends", DEPENDS, &[]),
            TaskDependencyChange::DependsOn { target_ids: vec![] },
        )
        .await;
        let visible = tasks(&mut engine).await;
        assert!(links(&visible[1], BLOCKING).is_empty());
        assert_eq!(visible[0]["taskDependencies"]["isBlocked"], false);
        reject(&mut engine, id).await;
        assert_eq!(links(&tasks(&mut engine).await[1], BLOCKING), vec!["a"]);
    });
}

#[test]
fn completion_and_reopen_recompute_dependent_blocked_facts() {
    block_on(async {
        for complete in [true, false] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let mut blocker = state("b", &[], &["a"]);
            let mut dependent = state("a", &["b"], &[]);
            if !complete {
                blocker["taskDependencies"]["properties"].as_array_mut().unwrap().push(json!({
                    "id":"b-status","propertyDefinitionId":STATUS,"value":{"__typename":"GraphqlSelectOptionPropertyValue","optionIds":[COMPLETED]}
                }));
                dependent["taskDependencies"]["isBlocked"] = json!(false);
                dependent["taskDependencies"]["openBlockerIds"] = json!([]);
            }
            let original = vec![dependent, blocker];
            seed(&mut engine, original.clone()).await;
            let options = if complete {
                vec![COMPLETED.to_owned()]
            } else {
                vec![]
            };
            let id = assign(&mut engine, "b", "11111111-1111-4111-8111-111111111111",
                json!({"id":"b-status","propertyDefinitionId":STATUS,"value":{"__typename":"GraphqlSelectOptionPropertyValue","optionIds":options}}),
                TaskDependencyChange::Status { option_ids: options }).await;
            assert_eq!(
                tasks(&mut engine).await[0]["taskDependencies"]["isBlocked"],
                !complete
            );
            let mut engine = Engine::new(engine.into_storage());
            assert_eq!(
                tasks(&mut engine).await[0]["taskDependencies"]["isBlocked"],
                !complete
            );
            reject(&mut engine, id).await;
            assert_eq!(tasks(&mut engine).await, original);
        }
    });
}

#[test]
fn retirement_drops_recipes_durably_without_dropping_commands() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let original = vec![state("a", &[], &[]), state("b", &[], &[])];
        seed(&mut engine, original.clone()).await;
        assign(
            &mut engine,
            "a",
            "11111111-1111-4111-8111-111111111111",
            property("a-depends", DEPENDS, &["b"]),
            TaskDependencyChange::DependsOn {
                target_ids: vec!["b".into()],
            },
        )
        .await;
        engine
            .retire_optimistic_snapshots_where(|_, source| source.task_dependency_recipe.is_some())
            .await
            .unwrap();
        let mut engine = Engine::new(engine.into_storage());
        assert_eq!(tasks(&mut engine).await, original);
        let queue = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(queue.len(), 1);
        assert!(
            decode_optimistic_source(&queue[0].optimistic.optimistic_data_json)
                .unwrap()
                .task_dependency_recipe
                .is_none()
        );
    });
}
