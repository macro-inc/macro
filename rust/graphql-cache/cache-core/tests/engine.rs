//! Engine-level tests: read/write flow, hot-tier eviction falling back to
//! storage, dependency-driven re-execution, teardown, clear.

use cache_core::engine::{Engine, ReadResult};
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{json, Value as Json};

const QUERY: &str = r#"
query Soup($input: SoupInput!) {
  soup(input: $input) {
    items {
      id
      entity {
        __typename
        ... on GraphqlSoupDocument { id documentName: name ownerId }
      }
    }
    nextCursor
    hasMore
  }
}
"#;

fn vars(limit: u64) -> serde_json::Map<String, Json> {
    let Json::Object(map) = json!({ "input": { "limit": limit } }) else {
        unreachable!()
    };
    map
}

fn page(names: &[(&str, &str)]) -> Json {
    json!({
        "soup": {
            "items": names.iter().map(|(id, name)| json!({
                "id": id,
                "entity": {
                    "__typename": "GraphqlSoupDocument",
                    "id": id,
                    "documentName": name,
                    "ownerId": "user-1"
                }
            })).collect::<Vec<_>>(),
            "nextCursor": null,
            "hasMore": false
        }
    })
}

#[test]
fn miss_then_write_then_hit() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());

        let read = engine
            .read_query(Some(1), QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap();
        assert!(matches!(read, ReadResult::Miss));

        let data = page(&[("doc-1", "Design doc")]);
        let write = engine
            .write_query(Some(1), QUERY, Some("Soup"), &vars(10), &data)
            .await
            .unwrap();
        assert!(!write.changed.is_empty());
        // Only op 1 is active and it's the origin — no re-executions.
        assert!(write.affected_ops.is_empty());

        let read = engine
            .read_query(Some(1), QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap();
        let ReadResult::Hit { data: cached } = read else {
            panic!("expected hit");
        };
        assert_eq!(cached, data);
    });
}

#[test]
fn cross_operation_invalidation() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());

        // Op 1: limit 10; Op 2: limit 20 — different root fields, shared
        // entity doc-1.
        engine
            .write_query(
                Some(1),
                QUERY,
                Some("Soup"),
                &vars(10),
                &page(&[("doc-1", "A")]),
            )
            .await
            .unwrap();
        engine
            .read_query(Some(1), QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap();

        // Op 2's response renames doc-1 → op 1 must be re-executed.
        let write = engine
            .write_query(
                Some(2),
                QUERY,
                Some("Soup"),
                &vars(20),
                &page(&[("doc-1", "B")]),
            )
            .await
            .unwrap();
        assert!(write.affected_ops.contains(&1), "affected: {write:?}");

        // Re-executed op 1 sees the new name.
        let ReadResult::Hit { data } = engine
            .read_query(Some(1), QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap()
        else {
            panic!("expected hit");
        };
        assert_eq!(
            data["soup"]["items"][0]["entity"]["documentName"],
            json!("B")
        );

        // Identical rewrite changes nothing → nobody re-executes.
        let write = engine
            .write_query(
                Some(2),
                QUERY,
                Some("Soup"),
                &vars(20),
                &page(&[("doc-1", "B")]),
            )
            .await
            .unwrap();
        assert!(write.changed.is_empty());
        assert!(write.affected_ops.is_empty());

        // After teardown op 1 is no longer notified.
        engine.teardown_operation(1);
        let write = engine
            .write_query(
                Some(2),
                QUERY,
                Some("Soup"),
                &vars(20),
                &page(&[("doc-1", "C")]),
            )
            .await
            .unwrap();
        assert!(!write.changed.is_empty());
        assert!(write.affected_ops.is_empty());
    });
}

#[test]
fn hot_tier_eviction_falls_back_to_storage() {
    block_on(async {
        // Capacity 2: a page with 3+ records (root + item + entity) forces
        // eviction between write and read.
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 2);

        let data = page(&[("doc-1", "A"), ("doc-2", "B"), ("doc-3", "C")]);
        engine
            .write_query(None, QUERY, Some("Soup"), &vars(10), &data)
            .await
            .unwrap();

        let ReadResult::Hit { data: cached } = engine
            .read_query(None, QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap()
        else {
            panic!("expected hit via storage");
        };
        assert_eq!(cached, data);
    });
}

#[test]
fn clear_wipes_everything() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &vars(10),
                &page(&[("doc-1", "A")]),
            )
            .await
            .unwrap();
        engine.clear().await.unwrap();
        let read = engine
            .read_query(None, QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap();
        assert!(matches!(read, ReadResult::Miss));
    });
}
