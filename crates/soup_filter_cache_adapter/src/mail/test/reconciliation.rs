use super::*;

const SOUP: &str = include_str!("reconciliation.graphql");

fn noise() -> Value {
    let mut filters = filters();
    filters["emailFilter"] = json!({"tree":{"literal":{"importance":false}}});
    filters
}
fn variables(direction: &str) -> Map<String, Value> {
    json!({"input":{"initial":{
        "filters":noise(), "sortMethod":"UPDATED_AT", "sortDirection":direction,
        "emailView":"INBOX", "limit":3
    }}})
    .as_object()
    .unwrap()
    .clone()
}
fn response(ids: &[u128], next: Value) -> Value {
    let items: Vec<_> = ids
        .iter()
        .map(|n| {
            let mut item = row(*n);
            item["properties"] = json!([]);
            item["isFavorited"] = json!(false);
            item["isSignal"] = json!(*n == 12);
            item
        })
        .collect();
    json!({"user":{"id":VIEWER,"emailLinks":[{"id":id(1000)}],"soup":{"items":items,"nextCursor":next}}})
}
async fn persist<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    operation: &str,
    vars: &Map<String, Value>,
    data: &Value,
) {
    let query = SOUP.replace("query Soup(", &format!("query {operation}("));
    let projections = projection_updates(
        engine.schema(),
        engine.storage(),
        &query,
        Some(operation),
        vars,
        data,
    )
    .await
    .unwrap();
    let projections = crate::properties::augment_authoritative(
        engine.schema(),
        engine.storage(),
        &query,
        Some(operation),
        vars,
        data,
        true,
        projections,
    )
    .await
    .unwrap();
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query: &query,
                operation_name: Some(operation),
                variables: vars,
                data,
                identity: Some(VIEWER),
            },
            projections,
        )
        .await
        .unwrap();
}
async fn current_keys<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    filter: Value,
    direction: &str,
) -> Vec<String> {
    let PageResult::MailPage { keys, .. } = page_current(
        engine,
        "generation",
        filter,
        "UPDATED_AT",
        direction,
        100,
        PageRequest {
            view: "INBOX".into(),
            cursor: None,
            through: None,
        },
    )
    .await
    .unwrap() else {
        panic!("complete mail page")
    };
    keys
}

async fn bounded_reconciliation<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let vars = variables("DESC");
    persist(
        &mut engine,
        "SoupMailBackfill",
        &vars,
        &response(&[20, 18, 16, 14, 12, 10, 8, 6, 4], Value::Null),
    )
    .await;
    assert_eq!(current_keys(&mut engine, noise(), "DESC").await.len(), 8);
    let network = response(&[20, 16, 8], json!("next-page"));
    persist(&mut engine, "Soup", &vars, &network).await;
    let expected: Vec<_> = [20, 16, 8, 6, 4]
        .map(|n| format!("{TYPE}:{}", id(n)))
        .into();
    assert_eq!(current_keys(&mut engine, noise(), "DESC").await, expected);
    // Re-evaluation, a repeated write and an engine restart cannot resurrect gaps.
    persist(&mut engine, "Soup", &vars, &network).await;
    let mut engine = Engine::new(engine.into_storage());
    assert_eq!(current_keys(&mut engine, noise(), "DESC").await, expected);
    assert!(
        current_keys(&mut engine, filters(), "DESC")
            .await
            .contains(&format!("{TYPE}:{}", id(12)))
    );
    assert!(
        engine
            .storage()
            .get_batch(&[EntityKey::entity(TYPE, &[&id(18)])])
            .await
            .unwrap()[0]
            .is_some(),
        "negative membership is not a normalized entity deletion"
    );
    // A fresh complete snapshot restores the facts; a partial patch cannot.
    let partial = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(18),"isRead":true
    }]}}});
    persist(&mut engine, "Partial", &vars, &partial).await;
    assert_eq!(current_keys(&mut engine, noise(), "DESC").await, expected);
    persist(
        &mut engine,
        "SoupMailBackfill",
        &vars,
        &response(&[18], Value::Null),
    )
    .await;
    assert!(
        current_keys(&mut engine, noise(), "DESC")
            .await
            .contains(&format!("{TYPE}:{}", id(18)))
    );
}

#[test]
fn authoritative_mail_page_invalidates_gaps_without_deleting_threads() {
    pollster::block_on(bounded_reconciliation(InMemoryStorage::new()));
}
#[test]
fn turso_authoritative_mail_page_invalidates_gaps_without_deleting_threads() {
    pollster::block_on(bounded_reconciliation(
        cache_turso::TursoStorage::open_in_memory("mail-reconciliation").unwrap(),
    ));
}
#[test]
fn ascending_boundary_preserves_rows_after_the_server_page() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let vars = variables("ASC");
        persist(
            &mut engine,
            "SoupMailBackfill",
            &vars,
            &response(&[4, 6, 8, 10, 14, 16], Value::Null),
        )
        .await;
        persist(
            &mut engine,
            "Soup",
            &vars,
            &response(&[4, 8, 14], json!("next")),
        )
        .await;
        assert_eq!(
            current_keys(&mut engine, noise(), "ASC").await,
            [4, 8, 14, 16].map(|n| format!("{TYPE}:{}", id(n)))
        );
    });
}
#[test]
fn exhausted_and_empty_first_pages_revoke_older_matches() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let vars = variables("DESC");
        persist(
            &mut engine,
            "SoupMailBackfill",
            &vars,
            &response(&[20, 18, 16, 12, 4], Value::Null),
        )
        .await;
        persist(&mut engine, "Soup", &vars, &response(&[20], Value::Null)).await;
        assert_eq!(
            current_keys(&mut engine, noise(), "DESC").await,
            [format!("{TYPE}:{}", id(20))]
        );
        persist(&mut engine, "Soup", &vars, &response(&[], Value::Null)).await;
        assert!(current_keys(&mut engine, noise(), "DESC").await.is_empty());
        assert_eq!(
            current_keys(&mut engine, filters(), "DESC").await,
            [format!("{TYPE}:{}", id(12))]
        );
    });
}
#[test]
fn partial_backfill_cursor_and_unsupported_queries_are_not_negative_evidence() {
    pollster::block_on(async {
        for case in [
            "backfill",
            "cursor",
            "unsupported",
            "partial",
            "no-cursor",
            "unordered",
            "created-at",
            "no-mail",
        ] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let mut vars = variables("DESC");
            persist(
                &mut engine,
                "SoupMailBackfill",
                &vars,
                &response(&[20, 18, 16, 4], Value::Null),
            )
            .await;
            let mut data = response(&[20, 16], json!("next"));
            let mut operation = "Soup";
            match case {
                "backfill" => operation = "SoupMailBackfill",
                "cursor" => {
                    vars = json!({"input":{"cursor":"server-cursor"}})
                        .as_object()
                        .unwrap()
                        .clone()
                }
                "unsupported" => {
                    vars["input"]["initial"]["filters"]["emailFilter"] =
                        json!({"tree":{"literal":{"sender":{"partial":"test"}}}})
                }
                "partial" => data["user"]["soup"]["items"][1]
                    .as_object_mut()
                    .unwrap()
                    .remove("latestInboundMessageTs")
                    .map(|_| ())
                    .unwrap(),
                "no-cursor" => data["user"]["soup"]
                    .as_object_mut()
                    .unwrap()
                    .remove("nextCursor")
                    .map(|_| ())
                    .unwrap(),
                "unordered" => data["user"]["soup"]["items"]
                    .as_array_mut()
                    .unwrap()
                    .reverse(),
                "created-at" => vars["input"]["initial"]["sortMethod"] = json!("CREATED_AT"),
                "no-mail" => vars["input"]["initial"]["emailView"] = Value::Null,
                _ => unreachable!(),
            }
            persist(&mut engine, operation, &vars, &data).await;
            assert!(
                current_keys(&mut engine, noise(), "DESC")
                    .await
                    .contains(&format!("{TYPE}:{}", id(18))),
                "{case}"
            );
        }
    });
}
