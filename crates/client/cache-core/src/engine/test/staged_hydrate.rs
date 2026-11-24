use super::*;
use serde_json::json;

const QUERY: &str = include_str!("hydration_search_changes.graphql");

/// Deterministic xorshift, so a failure names its seed.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn item(rng: &mut Rng) -> Json {
    let id = format!("doc-{}", rng.below(8));
    if rng.below(5) == 0 {
        return json!({
            "__typename": "GraphqlSoupEmailThread", "id": format!("thread-{}", rng.below(3)),
            "name": (["Re: plan", "Weekly", "Invoice"][rng.below(3) as usize]),
        });
    }
    let mut item = serde_json::Map::new();
    item.insert("__typename".into(), json!("GraphqlSoupDocument"));
    item.insert("id".into(), json!(id));
    if rng.below(3) != 0 {
        item.insert(
            "name".into(),
            json!(["Plan", "Notes", "Task"][rng.below(3) as usize]),
        );
    }
    if rng.below(2) == 0 {
        item.insert(
            "fileType".into(),
            json!(["md", "pdf"][rng.below(2) as usize]),
        );
    }
    if rng.below(2) == 0 {
        item.insert(
            "ownerId".into(),
            json!(["viewer", "other"][rng.below(2) as usize]),
        );
    }
    if rng.below(2) == 0 {
        item.insert(
            "subType".into(),
            json!({"__typename": "GraphqlTaskSubType", "isCompleted": rng.below(2) == 0}),
        );
    }
    if rng.below(3) == 0 {
        item.insert("properties".into(), json!([]));
    }
    Json::Object(item)
}

fn response(rng: &mut Rng) -> Json {
    let items: Vec<Json> = (0..=rng.below(4)).map(|_| item(rng)).collect();
    json!({"user": {"id": "viewer", "soup": {"items": items}}})
}

fn summary(result: &HydrationWriteResult) -> String {
    format!(
        "{:?} {:?} {:?}",
        result.write_result, result.search_changed_buckets, result.data
    )
}

/// A staged hydrate, with reads run between its two halves, writes what
/// the whole hydrate writes and reports what it reports.
#[test]
fn a_staged_hydrate_commits_as_the_whole_hydrate() {
    pollster::block_on(async {
        let variables = serde_json::Map::new();
        let mut staged_count = 0;
        for seed in 1..=40u64 {
            let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
            let mut whole = Engine::new(InMemoryStorage::new());
            let mut steps = Engine::new(InMemoryStorage::new());
            let mut keys = BTreeSet::new();
            for step in 0..30 {
                let data = response(&mut rng);
                let identity = (rng.below(4) != 0).then_some("viewer");
                let read = rng.below(2) == 0;
                if read {
                    for engine in [&mut whole, &mut steps] {
                        engine
                            .read_query(Some(step), QUERY, None, &variables)
                            .await
                            .unwrap();
                    }
                }
                let write = NetworkWrite {
                    query: QUERY,
                    operation_name: None,
                    variables: &variables,
                    data: &data,
                    identity,
                    channel: None,
                };
                // The staged side reads between its halves, so before its write.
                whole
                    .read_query(Some(1000 + step), QUERY, None, &variables)
                    .await
                    .unwrap();
                let expected = whole
                    .hydrate_query_with_projections(
                        NetworkWrite {
                            query: QUERY,
                            operation_name: None,
                            variables: &variables,
                            data: &data,
                            identity: identity,
                            channel: None,
                        },
                        Vec::new(),
                    )
                    .await
                    .unwrap();
                let actual = match steps.stage_hydrate(write, None, &[]).await.unwrap() {
                    Some(staged) => {
                        staged_count += 1;
                        // Reads run between the halves and change nothing.
                        steps
                            .read_query(Some(1000 + step), QUERY, None, &variables)
                            .await
                            .unwrap();
                        assert!(
                            steps.staged_hydrate_current(&staged),
                            "seed {seed} step {step}"
                        );
                        steps
                            .commit_staged_hydrate(staged, Vec::new())
                            .await
                            .unwrap()
                    }
                    None => {
                        steps
                            .read_query(Some(1000 + step), QUERY, None, &variables)
                            .await
                            .unwrap();
                        steps
                            .hydrate_query_with_projections(
                                NetworkWrite {
                                    query: QUERY,
                                    operation_name: None,
                                    variables: &variables,
                                    data: &data,
                                    identity: identity,
                                    channel: None,
                                },
                                Vec::new(),
                            )
                            .await
                            .unwrap()
                    }
                };
                assert_eq!(
                    summary(&actual),
                    summary(&expected),
                    "seed {seed} step {step}"
                );
                keys.extend(expected.write_result.changed.iter().cloned());
                let keys: Vec<_> = keys.iter().cloned().collect();
                assert_eq!(
                    steps.storage().get_batch(&keys).await.unwrap(),
                    whole.storage().get_batch(&keys).await.unwrap(),
                    "seed {seed} step {step}"
                );
            }
        }
        assert!(staged_count > 900, "only {staged_count} hydrates staged");
    });
}

/// A write between the halves makes the staged hydrate stale, so the host
/// runs the hydrate whole instead.
#[test]
fn a_write_between_the_halves_makes_a_staged_hydrate_stale() {
    pollster::block_on(async {
        let variables = serde_json::Map::new();
        let mut engine = Engine::new(InMemoryStorage::new());
        let first = json!({"user": {"id": "viewer", "soup": {"items": [
            {"__typename": "GraphqlSoupDocument", "id": "doc", "name": "Plan"}
        ]}}});
        engine
            .hydrate_query(QUERY, None, &variables, &first, Some("viewer"))
            .await
            .unwrap();
        let second = json!({"user": {"id": "viewer", "soup": {"items": [
            {"__typename": "GraphqlSoupDocument", "id": "doc", "name": "Notes"}
        ]}}});
        let staged = engine
            .stage_hydrate(
                NetworkWrite {
                    query: QUERY,
                    operation_name: None,
                    variables: &variables,
                    data: &second,
                    identity: Some("viewer"),
                    channel: None,
                },
                None,
                &[],
            )
            .await
            .unwrap()
            .expect("stageable");
        assert!(engine.staged_hydrate_current(&staged));
        let third = json!({"user": {"id": "viewer", "soup": {"items": [
            {"__typename": "GraphqlSoupDocument", "id": "doc", "name": "Task"}
        ]}}});
        engine
            .hydrate_query(QUERY, None, &variables, &third, Some("viewer"))
            .await
            .unwrap();
        assert!(!engine.staged_hydrate_current(&staged));
    });
}

/// Installing a schema changes neither revision nor storage, and the staged
/// write was computed with the old one, so it is stale too.
#[test]
fn a_schema_installed_between_the_halves_makes_a_staged_hydrate_stale() {
    pollster::block_on(async {
        let variables = serde_json::Map::new();
        let mut engine = Engine::new(InMemoryStorage::new());
        let data = json!({"user": {"id": "viewer", "soup": {"items": [
            {"__typename": "GraphqlSoupDocument", "id": "doc", "name": "Plan"}
        ]}}});
        engine
            .hydrate_query(QUERY, None, &variables, &data, Some("viewer"))
            .await
            .unwrap();
        let write = NetworkWrite {
            query: QUERY,
            operation_name: None,
            variables: &variables,
            data: &data,
            identity: Some("viewer"),
            channel: None,
        };
        let staged = engine
            .stage_hydrate(write, None, &[])
            .await
            .unwrap()
            .expect("stageable");
        assert!(engine.staged_hydrate_current(&staged));
        let schema = engine.schema_snapshot();
        engine.install_schema(&schema).unwrap();
        assert!(!engine.staged_hydrate_current(&staged));
    });
}

/// A staged hydrate holds the hot records it merges into until it commits:
/// a read between the halves finds them in storage, which still has them,
/// and the commit puts them back. A staged hydrate that is dropped leaves
/// them in storage only.
#[test]
fn a_staged_hydrate_holds_its_hot_records_until_it_commits() {
    pollster::block_on(async {
        let variables = serde_json::Map::new();
        let mut engine = Engine::new(InMemoryStorage::new());
        let data = json!({"user": {"id": "viewer", "soup": {"items": [
            {"__typename": "GraphqlSoupDocument", "id": "doc", "name": "Plan"}
        ]}}});
        let key = EntityKey::entity("GraphqlSoupDocument", &["doc"]);
        engine
            .hydrate_query(QUERY, None, &variables, &data, Some("viewer"))
            .await
            .unwrap();
        assert!(engine.hot.contains(&key));
        let stored = engine
            .storage()
            .get_batch(std::slice::from_ref(&key))
            .await
            .unwrap();
        assert!(stored[0].is_some());
        let write = || NetworkWrite {
            query: QUERY,
            operation_name: None,
            variables: &variables,
            data: &data,
            identity: Some("viewer"),
            channel: None,
        };

        let staged = engine
            .stage_hydrate(write(), None, &[])
            .await
            .unwrap()
            .expect("stageable");
        assert!(!engine.hot.contains(&key));
        assert!(engine.staged_hydrate_current(&staged));
        engine
            .commit_staged_hydrate(staged, Vec::new())
            .await
            .unwrap();
        assert_eq!(engine.hot.peek(&key), stored[0].as_ref());

        drop(
            engine
                .stage_hydrate(write(), None, &[])
                .await
                .unwrap()
                .expect("stageable"),
        );
        assert!(!engine.hot.contains(&key));
        assert_eq!(
            engine
                .storage()
                .get_batch(std::slice::from_ref(&key))
                .await
                .unwrap(),
            stored
        );
    });
}

/// Binding the account and composing with optimistic layers stay whole.
#[test]
fn a_hydrate_that_binds_the_account_is_not_staged() {
    pollster::block_on(async {
        let variables = serde_json::Map::new();
        let mut engine = Engine::new(InMemoryStorage::new());
        let data = json!({"user": {"id": "viewer", "soup": {"items": []}}});
        let write = NetworkWrite {
            query: QUERY,
            operation_name: None,
            variables: &variables,
            data: &data,
            identity: Some("viewer"),
            channel: None,
        };
        assert!(
            engine
                .stage_hydrate(write, None, &[])
                .await
                .unwrap()
                .is_none()
        );
        engine
            .hydrate_query(QUERY, None, &variables, &data, Some("viewer"))
            .await
            .unwrap();
        assert!(
            engine
                .stage_hydrate(write, None, &[])
                .await
                .unwrap()
                .is_some()
        );
        let other = NetworkWrite {
            identity: Some("someone-else"),
            ..write
        };
        assert!(
            engine
                .stage_hydrate(other, None, &[])
                .await
                .unwrap()
                .is_none()
        );
    });
}

/// A request the whole hydrate rejects before reading storage is not staged
/// and reads no storage either: a failed read there would mark storage for
/// reset where the whole hydrate reports the request.
#[test]
fn a_mutation_is_not_staged_and_reads_no_storage() {
    pollster::block_on(async {
        let variables = serde_json::Map::new();
        let mut engine = Engine::new(InMemoryStorage::new());
        let data = json!({"setEntityProperty": {"id": "property"}});
        let write = NetworkWrite {
            query: "mutation { setEntityProperty { id } }",
            operation_name: None,
            variables: &variables,
            data: &data,
            identity: None,
            channel: None,
        };
        assert!(
            engine
                .stage_hydrate(write, None, &[])
                .await
                .unwrap()
                .is_none()
        );
        assert!(!engine.optimistic_hydrated, "the queue was not read");
        let whole = engine
            .hydrate_query(write.query, None, &variables, &data, None)
            .await
            .expect_err("query-only");
        assert!(whole.to_string().contains("query-only"), "{whole}");
    });
}
