use cache_core::engine::Engine;
use cache_core::entity_index::{EntityBucket, EntityIndexQuery};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use std::collections::BTreeMap;

fn entity(
    typename: &str,
    id: &str,
    viewed_at: &str,
    file_type: Option<&str>,
    subtype: Option<&str>,
) -> (EntityKey, Record) {
    let mut fields: BTreeMap<_, _> = [
        ("__typename".into(), CacheValue::String(typename.into())),
        ("id".into(), CacheValue::String(id.into())),
        ("name".into(), CacheValue::String(format!("Entity {id}"))),
        ("viewedAt".into(), CacheValue::String(viewed_at.into())),
        (
            "properties".into(),
            CacheValue::Ref(EntityKey::entity("GraphqlProperty", &["property-1"])),
        ),
    ]
    .into_iter()
    .collect();
    if let Some(file_type) = file_type {
        fields.insert("fileType".into(), CacheValue::String(file_type.into()));
    }
    if let Some(subtype) = subtype {
        fields.insert(
            "subType".into(),
            CacheValue::Object(
                [("kind".into(), CacheValue::String(subtype.into()))]
                    .into_iter()
                    .collect(),
            ),
        );
    }
    (EntityKey::entity(typename, &[id]), Record { fields })
}

#[test]
fn engine_pages_filters_and_decodes_indexed_entities() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch(vec![
                entity(
                    "GraphqlSoupDocument",
                    "doc-b",
                    "1970-01-01T00:00:03Z",
                    Some("md"),
                    None,
                ),
                entity(
                    "GraphqlSoupDocument",
                    "doc-a",
                    "1970-01-01T00:00:03Z",
                    Some("md"),
                    Some("task"),
                ),
                entity(
                    "GraphqlSoupChat",
                    "chat-1",
                    "1970-01-01T00:00:02Z",
                    None,
                    None,
                ),
                entity(
                    "GraphqlSoupDocument",
                    "snippet-1",
                    "1970-01-01T00:00:01Z",
                    Some("md"),
                    Some("snippet"),
                ),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);

        let first = engine
            .query_indexed_items(&EntityIndexQuery {
                buckets: Vec::new(),
                cursor: None,
                limit: 2,
            })
            .await
            .unwrap();
        assert_eq!(
            first
                .items
                .iter()
                .map(|item| (item.id.as_str(), item.bucket))
                .collect::<Vec<_>>(),
            vec![("doc-a", EntityBucket::Task), ("doc-b", EntityBucket::Note),]
        );
        assert!(first.has_more);
        assert_eq!(first.items[1].entity["name"], "Entity doc-b");
        assert!(first.items[1].entity.get("properties").is_none());

        let second = engine
            .query_indexed_items(&EntityIndexQuery {
                buckets: Vec::new(),
                cursor: first.next_cursor,
                limit: 2,
            })
            .await
            .unwrap();
        assert_eq!(
            second
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["chat-1", "snippet-1"]
        );
        assert!(!second.has_more);
        assert!(second.next_cursor.is_none());

        let selected = engine
            .query_indexed_items(&EntityIndexQuery {
                buckets: vec![EntityBucket::Note, EntityBucket::Chat],
                cursor: None,
                limit: 10,
            })
            .await
            .unwrap();
        assert_eq!(
            selected
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["doc-b", "chat-1"]
        );
    });
}
