//! Engine-level tests: read/write flow, hot-tier eviction falling back to
//! storage, dependency-driven re-execution, teardown, clear.

use cache_core::engine::{Engine, ReadResult};
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{json, Value as Json};

const QUERY: &str = r#"
query Soup($input: SoupInput!) {
  user {
    id
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
}
"#;

fn vars(limit: u64) -> serde_json::Map<String, Json> {
    let Json::Object(map) = json!({ "input": { "limit": limit } }) else {
        unreachable!()
    };
    map
}

fn page(names: &[(&str, &str)]) -> Json {
    page_for_user("user-1", names)
}

fn page_for_user(user: &str, names: &[(&str, &str)]) -> Json {
    json!({
        "user": {
            "id": user,
            "soup": {
                "items": names.iter().map(|(id, name)| json!({
                    "id": id,
                    "entity": {
                        "__typename": "GraphqlSoupDocument",
                        "id": id,
                        "documentName": name,
                        "ownerId": user
                    }
                })).collect::<Vec<_>>(),
                "nextCursor": null,
                "hasMore": false
            }
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
            .write_query(Some(1), QUERY, Some("Soup"), &vars(10), &data, None)
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
                None,
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
                None,
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
            data["user"]["soup"]["items"][0]["entity"]["documentName"],
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
                None,
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
                None,
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
            .write_query(None, QUERY, Some("Soup"), &vars(10), &data, None)
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
                None,
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

#[test]
fn identity_witness_wipes_on_user_change() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());

        // User A populates the cache; op 1 is active.
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &vars(10),
                &page(&[("doc-1", "A")]),
                None,
            )
            .await
            .unwrap();
        engine
            .read_query(Some(1), QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap();

        // Same user again: no reset. Untagged writes never reset either.
        let write = engine
            .write_query(
                Some(2),
                QUERY,
                Some("Soup"),
                &vars(20),
                &page(&[("doc-2", "B")]),
                Some("user-1"),
            )
            .await
            .unwrap();
        assert!(!write.reset);
        let write = engine
            .write_query(
                Some(2),
                QUERY,
                Some("Soup"),
                &vars(20),
                &page(&[("doc-2", "B2")]),
                None,
            )
            .await
            .unwrap();
        assert!(!write.reset);

        // A response for a different user wipes everything (silent restart).
        let write = engine
            .write_query(
                Some(2),
                QUERY,
                Some("Soup"),
                &vars(20),
                &page_for_user("user-2", &[("doc-9", "Z")]),
                Some("user-2"),
            )
            .await
            .unwrap();
        assert!(write.reset);
        // Every active op except the origin re-executes.
        assert!(write.affected_ops.contains(&1));
        assert!(!write.affected_ops.contains(&2));

        // Old user's data is gone; new user's write landed.
        let read = engine
            .read_query(Some(1), QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap();
        assert!(matches!(read, ReadResult::Miss));
        let read = engine
            .read_query(Some(2), QUERY, Some("Soup"), &vars(20))
            .await
            .unwrap();
        let ReadResult::Hit { data } = read else {
            panic!("expected hit for new user");
        };
        assert_eq!(data["user"]["id"], serde_json::json!("user-2"));

        // external_reset drops local state and reports all local ops.
        let ops = engine.external_reset();
        assert!(ops.contains(&1) && ops.contains(&2));
    });
}

#[test]
fn capacity_constrained_rewrite_preserves_fields() {
    block_on(async {
        // Hot capacity far below the batch size: during a write, the batch
        // itself exceeds the LRU. A partial re-write over the same entities
        // must still merge against storage, not clobber it.
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 2);

        // Full write: documentName + ownerId (well over 2 records: root,
        // user, 3 items, 3 documents).
        let full = page(&[("doc-1", "A"), ("doc-2", "B"), ("doc-3", "C")]);
        engine
            .write_query(None, QUERY, Some("Soup"), &vars(10), &full, None)
            .await
            .unwrap();

        // Partial re-write of the same entities via a narrower query (no
        // ownerId), renaming them.
        const PARTIAL_QUERY: &str = r#"
        query Soup($input: SoupInput!) {
          user {
            id
            soup(input: $input) {
              items {
                id
                entity {
                  __typename
                  ... on GraphqlSoupDocument { id documentName: name }
                }
              }
              nextCursor
              hasMore
            }
          }
        }
        "#;
        let partial = json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "items": [
                        { "id": "doc-1", "entity": { "__typename": "GraphqlSoupDocument", "id": "doc-1", "documentName": "A2" } },
                        { "id": "doc-2", "entity": { "__typename": "GraphqlSoupDocument", "id": "doc-2", "documentName": "B2" } },
                        { "id": "doc-3", "entity": { "__typename": "GraphqlSoupDocument", "id": "doc-3", "documentName": "C2" } }
                    ],
                    "nextCursor": null,
                    "hasMore": false
                }
            }
        });
        engine
            .write_query(None, PARTIAL_QUERY, Some("Soup"), &vars(10), &partial, None)
            .await
            .unwrap();

        // The full query must still be answerable: ownerId preserved from
        // the first write, names updated by the second.
        let ReadResult::Hit { data } = engine
            .read_query(None, QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap()
        else {
            panic!("expected hit: partial re-write must not drop fields");
        };
        let items = data["user"]["soup"]["items"].as_array().unwrap();
        assert_eq!(items.len(), 3);
        for (item, name) in items.iter().zip(["A2", "B2", "C2"]) {
            assert_eq!(item["entity"]["documentName"], json!(name));
            assert_eq!(item["entity"]["ownerId"], json!("user-1"));
        }
    });
}
