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
                };
                // The staged side reads between its halves, so before its write.
                whole
                    .read_query(Some(1000 + step), QUERY, None, &variables)
                    .await
                    .unwrap();
                let expected = whole
                    .hydrate_query_with_projections(
                        QUERY,
                        None,
                        &variables,
                        &data,
                        identity,
                        Vec::new(),
                    )
                    .await
                    .unwrap();
                let actual = match steps.stage_hydrate(write, None, &[]).await {
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
                                QUERY,
                                None,
                                &variables,
                                &data,
                                identity,
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
                },
                None,
                &[],
            )
            .await
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
        };
        assert!(engine.stage_hydrate(write, None, &[]).await.is_none());
        engine
            .hydrate_query(QUERY, None, &variables, &data, Some("viewer"))
            .await
            .unwrap();
        assert!(engine.stage_hydrate(write, None, &[]).await.is_some());
        let other = NetworkWrite {
            identity: Some("someone-else"),
            ..write
        };
        assert!(engine.stage_hydrate(other, None, &[]).await.is_none());
    });
}
