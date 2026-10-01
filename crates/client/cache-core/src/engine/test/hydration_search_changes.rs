use super::*;
use crate::record_selection::RecordSelection;
use crate::value::CacheValue;
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
fn nested_task_completion_hydration_invalidates_task_searches() {
    pollster::block_on(async {
        for cold in [false, true] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let task = json!({
                "__typename": "GraphqlSoupDocument", "id": "task", "name": "Task",
                "fileType": "md", "ownerId": "viewer", "properties": [],
                "subType": { "__typename": "GraphqlTaskSubType", "isCompleted": false }
            });
            hydrate(&mut engine, task).await;
            let document_key = EntityKey::entity("GraphqlSoupDocument", &["task"]);
            let records = engine
                .storage()
                .get_batch(std::slice::from_ref(&document_key))
                .await
                .unwrap();
            // Task subtypes have no id: normalization embeds the object in
            // its document rather than creating a GraphqlTaskSubType ref.
            assert!(
                crate::meta::type_meta("GraphqlTaskSubType")
                    .unwrap()
                    .key_fields
                    .is_none()
            );
            let CacheValue::Object(subtype) = &records[0].as_ref().unwrap().fields["subType"]
            else {
                panic!("task subtype must stay embedded in its document");
            };
            assert_eq!(subtype["isCompleted"], CacheValue::Bool(false));
            let selection =
                RecordSelection::parse(include_str!("task_completion.graphql"), "TaskCompletion")
                    .unwrap();
            if cold {
                engine = Engine::new(engine.into_storage());
            }
            for completed in [true, false] {
                // No title, owner, timestamp, or other parent field changes.
                let patch = json!({
                    "__typename": "GraphqlSoupDocument", "id": "task",
                    "subType": { "__typename": "GraphqlTaskSubType", "isCompleted": completed }
                });
                let result = hydrate(&mut engine, patch.clone()).await;
                assert_eq!(
                    result.write_result.changed,
                    BTreeSet::from([document_key.clone()])
                );
                assert_eq!(
                    result.search_changed_buckets,
                    BTreeSet::from(["task".into()]),
                    "cold={cold}"
                );
                // History/Quick Access materialize through fragment-rooted reads.
                let items = engine
                    .read_records_by_keys(&selection, std::slice::from_ref(&document_key))
                    .await
                    .unwrap();
                assert_eq!(items.len(), 1);
                assert_eq!(items[0].record["subType"]["isCompleted"], json!(completed));
                let duplicate = hydrate(&mut engine, patch).await;
                assert!(
                    duplicate.search_changed_buckets.is_empty(),
                    "identical completion must not refresh"
                );
            }
        }
    });
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
