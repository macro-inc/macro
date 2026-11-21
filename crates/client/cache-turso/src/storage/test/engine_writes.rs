use super::*;
use cache_core::engine::{Engine, NetworkWrite, ReadResult};
use cache_core::value::CacheValue;
use serde_json::{Value as Json, json};

const FULL: &str = "query Full { user { id soup(input: {limit: 50}) { items { __typename id ... on GraphqlSoupDocument { value: name extra: ownerId } } nextCursor } } }";
const PARTIAL: &str = "query Partial { user { id soup(input: {limit: 50}) { items { __typename id ... on GraphqlSoupDocument { value: name } } nextCursor } } }";

#[test]
fn account_reset_commits_its_authority_without_postcommit_io() {
    block_on(async {
        let mut engine =
            Engine::new(TursoStorage::open_in_memory("authority-reset-atomicity").unwrap());
        engine.current_authority("profile").await.unwrap();
        let variables = serde_json::Map::new();
        let query = "{ user { id } }";
        engine
            .write_query(
                None,
                query,
                None,
                &variables,
                &json!({"user":{"id":"before"}}),
                Some("before"),
            )
            .await
            .unwrap();
        let before = engine.authority_snapshot().unwrap().clone();
        assert_eq!(before.account.as_deref(), Some("before"));
        engine.storage().arm_fault(TestFault::After {
            site: TestFaultSite::Put,
            index: 0,
        });
        assert!(
            engine
                .write_query(
                    None,
                    query,
                    None,
                    &variables,
                    &json!({"user":{"id":"after"}}),
                    Some("after")
                )
                .await
                .is_err()
        );
        assert_eq!(engine.authority_snapshot(), Some(&before));
        assert_eq!(
            engine.current_identity().await.unwrap().as_deref(),
            Some("before")
        );
        engine
            .write_query(
                None,
                query,
                None,
                &variables,
                &json!({"user":{"id":"after"}}),
                Some("after"),
            )
            .await
            .unwrap();
        let committed = engine.authority_snapshot().unwrap().clone();
        assert_eq!(committed.account.as_deref(), Some("after"));
        assert_ne!(committed.generation, before.generation);
        let changes = engine.storage().connection().total_changes();
        assert_eq!(
            engine.current_authority("profile").await.unwrap(),
            committed
        );
        assert_eq!(engine.storage().connection().total_changes(), changes);
        let mut reopened = Engine::new(engine.into_storage());
        assert_eq!(
            reopened.current_authority("profile").await.unwrap(),
            committed
        );
    });
}

#[test]
fn derived_response_records_commit_in_the_response_transaction() {
    block_on(async {
        let mut engine =
            Engine::new(TursoStorage::open_in_memory("response-record-atomicity").unwrap())
                .with_response_records(|_, _, _, _, _| {
                    Ok([(
                        key("ResponseOwner:one"),
                        Record {
                            fields: [("owner".into(), CacheValue::Ref(key("GraphqlUser:viewer")))]
                                .into(),
                        },
                    )]
                    .into())
                });
        let query = "{ user { id } }";
        let variables = serde_json::Map::new();
        let data = json!({"user":{"id":"viewer"}});
        let keys = [key("ResponseOwner:one"), key("GraphqlUser:viewer")];
        engine.storage().arm_fault(TestFault::After {
            site: TestFaultSite::Put,
            index: 1,
        });
        assert!(
            engine
                .write_query(None, query, None, &variables, &data, None)
                .await
                .is_err()
        );
        assert!(
            engine
                .storage()
                .get_batch(&keys)
                .await
                .unwrap()
                .iter()
                .all(Option::is_none)
        );
        let result = engine
            .write_query(None, query, None, &variables, &data, None)
            .await
            .unwrap();
        assert_eq!(result.revision.to_string(), "1");
        assert!(
            engine
                .storage()
                .get_batch(&keys)
                .await
                .unwrap()
                .iter()
                .all(Option::is_some)
        );
    });
}

fn page(count: usize) -> Json {
    json!({"user": {"id": "viewer", "soup": {"items": (0..count).map(|id| json!({
        "__typename": "GraphqlSoupDocument", "id": id.to_string(), "value": "original",
        "extra": "owner".repeat(32),
    })).collect::<Vec<_>>(), "nextCursor": null}}})
}

async fn assert_page(engine: &mut Engine<TursoStorage>, expected: &Json) {
    let ReadResult::Hit { data } = engine
        .read_query(None, FULL, Some("Full"), &serde_json::Map::new())
        .await
        .unwrap()
    else {
        panic!("expected cached page");
    };
    assert_eq!(&data, expected);
}

#[test]
fn unchanged_network_records_do_not_write_even_after_hot_eviction() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("unchanged-engine-records").unwrap();
        let mut engine = Engine::with_capacity(storage, 2);
        let data = page(12);
        let variables = serde_json::Map::new();
        engine
            .write_query(None, FULL, Some("Full"), &variables, &data, None)
            .await
            .unwrap();
        let before = engine.storage().connection().total_changes();
        let result = engine
            .write_query(None, FULL, Some("Full"), &variables, &data, None)
            .await
            .unwrap();
        assert!(result.changed.is_empty());
        assert!(!result.revision_advanced);
        assert_eq!(engine.storage().connection().total_changes() - before, 0);
        assert_page(&mut engine, &data).await;
    });
}

#[test]
fn mixed_partial_refresh_writes_only_the_changed_record() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("partial-engine-records").unwrap();
        let mut engine = Engine::with_capacity(storage, 2);
        let mut full = page(12);
        let variables = serde_json::Map::new();
        engine
            .write_query(None, FULL, Some("Full"), &variables, &full, None)
            .await
            .unwrap();
        full["user"]["soup"]["items"][3]["value"] = json!("updated");
        let mut partial = full.clone();
        for node in partial["user"]["soup"]["items"].as_array_mut().unwrap() {
            node.as_object_mut().unwrap().remove("extra");
        }
        let before = engine.storage().connection().total_changes();
        let result = engine
            .write_query(None, PARTIAL, Some("Partial"), &variables, &partial, None)
            .await
            .unwrap();
        assert_eq!(result.changed, [key("GraphqlSoupDocument:3")].into());
        // One normalized record and its compact search document.
        assert_eq!(engine.storage().connection().total_changes() - before, 2);
        assert_page(&mut engine, &full).await;
        let mut reopened = Engine::new(engine.into_storage());
        assert_page(&mut reopened, &full).await;
    });
}

#[test]
fn failed_refresh_keeps_hot_and_durable_data_old_until_retry_commits() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("failed-engine-records").unwrap();
        let mut engine = Engine::new(storage);
        let original = page(2);
        let variables = serde_json::Map::new();
        engine
            .write_query(None, FULL, Some("Full"), &variables, &original, None)
            .await
            .unwrap();
        assert_page(&mut engine, &original).await;
        let revision = engine.current_revision();
        let mut updated = original.clone();
        updated["user"]["soup"]["items"][0]["value"] = json!("updated");
        engine.storage().arm_fault(TestFault::After {
            site: TestFaultSite::Put,
            index: 0,
        });
        assert!(
            engine
                .write_query(None, FULL, Some("Full"), &variables, &updated, None)
                .await
                .is_err()
        );
        assert_eq!(engine.current_revision(), revision);
        assert_page(&mut engine, &original).await;
        let result = engine
            .write_query(None, FULL, Some("Full"), &variables, &updated, None)
            .await
            .unwrap();
        assert_eq!(result.changed, [key("GraphqlSoupDocument:0")].into());
        assert!(result.revision_advanced);
        let mut reopened = Engine::new(engine.into_storage());
        assert_page(&mut reopened, &updated).await;
    });
}

#[test]
fn failed_initial_write_does_not_publish_uncommitted_hot_records() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("failed-initial-engine-records").unwrap();
        let mut engine = Engine::new(storage);
        let data = page(2);
        let variables = serde_json::Map::new();
        engine.storage().arm_fault(TestFault::After {
            site: TestFaultSite::Put,
            index: 0,
        });
        assert!(
            engine
                .write_query(None, FULL, Some("Full"), &variables, &data, None)
                .await
                .is_err()
        );
        assert!(matches!(
            engine
                .read_query(None, FULL, Some("Full"), &variables)
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        engine
            .write_query(None, FULL, Some("Full"), &variables, &data, None)
            .await
            .unwrap();
        let mut reopened = Engine::new(engine.into_storage());
        assert_page(&mut reopened, &data).await;
    });
}

#[test]
fn unchanged_records_still_commit_projection_only_changes() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("projection-only-engine-records").unwrap();
        let mut engine = Engine::new(storage);
        let data = page(2);
        let variables = serde_json::Map::new();
        engine
            .write_query(None, FULL, Some("Full"), &variables, &data, None)
            .await
            .unwrap();
        let projection = authoritative_projection("GraphqlSoupDocument:0", "owner");
        let result = engine
            .write_query_with_registration_and_projections(
                None,
                None,
                NetworkWrite {
                    query: FULL,
                    operation_name: Some("Full"),
                    variables: &variables,
                    data: &data,
                    identity: None,
                },
                vec![ProjectionMutation::Replace(projection.clone())],
            )
            .await
            .unwrap();
        assert!(result.changed.is_empty());
        assert!(result.revision_advanced);
        assert_eq!(
            engine
                .storage()
                .load_projection_states(
                    &[PredicateRecordKey::new("GraphqlSoupDocument:0").unwrap()]
                )
                .await
                .unwrap(),
            vec![Some(ProjectionState::Complete(projection))]
        );
        assert_page(&mut engine, &data).await;
    });
}
