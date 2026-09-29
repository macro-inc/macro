use super::*;
use serde_json::json;

const QUERY: &str = include_str!("hydration_search_changes.graphql");

async fn hydrate(engine: &mut Engine<InMemoryStorage>, item: Json) -> HydrationWriteResult {
    engine
        .hydrate_query(
            QUERY,
            None,
            &serde_json::Map::new(),
            &json!({"user": {"id": "viewer", "soup": {"items": [item]}}}),
            None,
        )
        .await
        .unwrap()
}

#[test]
fn hydration_reports_search_changes_without_needing_a_loaded_search_catalog() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut document = json!({
            "__typename": "GraphqlSoupDocument", "id": "doc", "name": "Note",
            "fileType": "md", "ownerId": "viewer", "properties": []
        });
        assert_eq!(
            hydrate(&mut engine, document.clone())
                .await
                .search_changed_buckets,
            BTreeSet::from(["note".into()])
        );
        assert!(
            hydrate(&mut engine, document.clone())
                .await
                .search_changed_buckets
                .is_empty()
        );

        // The before state can come from cold storage as well as the hot tier.
        let mut engine = Engine::new(engine.into_storage());
        document["properties"] = json!([{"id": "property-1"}]);
        let result = hydrate(&mut engine, document.clone()).await;
        assert!(result.write_result.revision_advanced);
        assert!(!result.write_result.changed.is_empty());
        assert!(result.search_changed_buckets.is_empty());

        document["ownerId"] = json!("new-owner");
        assert_eq!(
            hydrate(&mut engine, document).await.search_changed_buckets,
            BTreeSet::from(["note".into()])
        );
        assert_eq!(
            hydrate(
                &mut engine,
                json!({
                    "__typename": "GraphqlSoupEmailThread", "id": "thread", "name": "Mail"
                })
            )
            .await
            .search_changed_buckets,
            BTreeSet::from(["email".into()])
        );
    });
}
