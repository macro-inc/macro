//! Engine-level tests: read/write flow, hot-tier eviction falling back to
//! storage, dependency-driven re-execution, teardown, clear.

use cache_core::engine::{Engine, NetworkWrite, QueryRegistration, ReadResult};
use cache_core::revision::CacheRevision;
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Value as Json, json};

const QUERY: &str = r#"
query Soup($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupDocument { documentName: name ownerId }
      }
      nextCursor
    }
  }
}
"#;

const HYDRATION_QUERY: &str = r#"
query SoupBackfill($input: SoupInput!) {
  user {
    id @cacheOnly
    soup(input: $input) {
      items @cacheOnly {
        __typename
        id
        ... on GraphqlSoupDocument { documentName: name ownerId }
      }
      nextCursor
    }
  }
}
"#;

const VOID_HYDRATION_QUERY: &str = r#"
query SoupBackfill($input: SoupInput!) {
  user @cacheOnly {
    id
    soup(input: $input) {
      items { __typename id }
      nextCursor
    }
  }
}
"#;

const CHANNEL_NOTIFICATIONS_QUERY: &str = r#"
query ChannelNotifications($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupChannel {
          notifications {
            __typename
            id
            seen
            viewedAt
          }
        }
      }
      nextCursor
    }
  }
}
"#;

const RECORD_CHANNEL_ACTIVITY_MUTATION: &str = r#"
mutation RecordChannelActivity($input: RecordChannelActivityInput!) {
  recordChannelActivity(input: $input) {
    __typename
    id
    channelId
    viewedAt
  }
}
"#;

const UPDATE_NOTIFICATIONS_MUTATION: &str = r#"
mutation UpdateNotifications($input: UpdateNotificationsInput!) {
  updateNotifications(input: $input) {
    __typename
    id
    seen
    viewedAt
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
                    "__typename": "GraphqlSoupDocument",
                    "id": id,
                    "documentName": name,
                    "ownerId": user
                })).collect::<Vec<_>>(),
                "nextCursor": null
            }
        }
    })
}

#[test]
fn consuming_engine_returns_exclusively_owned_storage() {
    let engine = Engine::new(InMemoryStorage::new());
    let storage: InMemoryStorage = engine.into_storage();
    assert!(storage.is_empty());
}

#[test]
fn revision_tracks_logical_mutations_only_within_one_engine_generation() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        assert_eq!(engine.current_revision(), CacheRevision::ZERO);

        let data = page(&[("doc-1", "A")]);
        let first = engine
            .write_query(None, QUERY, Some("Soup"), &vars(10), &data, None)
            .await
            .unwrap();
        assert_eq!(first.revision.to_string(), "1");
        assert_eq!(engine.current_revision(), first.revision);

        engine
            .read_query(None, QUERY, Some("Soup"), &vars(10))
            .await
            .unwrap();
        assert_eq!(engine.current_revision(), first.revision);

        // Conservative advancement: an idempotent logical write still makes
        // older observations stale.
        let second = engine
            .write_query(None, QUERY, Some("Soup"), &vars(10), &data, None)
            .await
            .unwrap();
        assert!(second.changed.is_empty());
        assert_eq!(second.revision.to_string(), "2");

        let storage = engine.storage().clone();
        let mut replacement = Engine::new(storage);
        assert_eq!(replacement.current_revision(), CacheRevision::ZERO);
        assert!(matches!(
            replacement
                .read_query(None, QUERY, Some("Soup"), &vars(10))
                .await
                .unwrap(),
            ReadResult::Hit { .. }
        ));
        assert_eq!(replacement.current_revision(), CacheRevision::ZERO);

        let cleared = replacement.clear().await.unwrap();
        assert_eq!(cleared.to_string(), "1");
        assert_eq!(replacement.current_revision(), cleared);
    });
}

#[test]
fn failed_commands_do_not_advance_revision() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let result = engine
            .write_query(
                None,
                "query Broken {",
                Some("Broken"),
                &serde_json::Map::new(),
                &json!({}),
                None,
            )
            .await;
        assert!(result.is_err());
        assert_eq!(engine.current_revision(), CacheRevision::ZERO);
    });
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
fn hydration_persists_cache_only_fields_and_returns_only_projection() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let data = json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": "doc-1",
                        "documentName": "Design doc",
                        "ownerId": "user-1"
                    }],
                    "nextCursor": "cursor-2"
                }
            }
        });

        let hydration = engine
            .hydrate_query(
                HYDRATION_QUERY,
                Some("SoupBackfill"),
                &vars(10),
                &data,
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            hydration.data,
            Some(json!({ "user": { "soup": { "nextCursor": "cursor-2" } } }))
        );

        let ReadResult::Hit { data: cached } = engine
            .read_query(None, HYDRATION_QUERY, Some("SoupBackfill"), &vars(10))
            .await
            .unwrap()
        else {
            panic!("expected hydrated query hit");
        };
        assert_eq!(cached, data);
    });
}

#[test]
fn fully_cache_only_hydration_returns_void_projection() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let hydration = engine
            .hydrate_query(
                VOID_HYDRATION_QUERY,
                Some("SoupBackfill"),
                &vars(10),
                &page(&[("doc-1", "Design doc")]),
                None,
            )
            .await
            .unwrap();
        assert_eq!(hydration.data, None);
    });
}

#[test]
fn cross_operation_invalidation() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());

        // Op 1: limit 10; Op 2: limit 20 — different root fields, shared
        // entity doc-1. Seed first so registration must include records that
        // the registered write itself does not change.
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
        let registered = engine
            .write_query_with_registration(
                Some(1),
                Some(QueryRegistration {
                    op_id: 1,
                    entity_resolvers: &[],
                }),
                NetworkWrite {
                    query: QUERY,
                    operation_name: Some("Soup"),
                    variables: &vars(10),
                    data: &page(&[("doc-1", "A")]),
                    identity: None,
                },
            )
            .await
            .unwrap();
        assert!(registered.changed.is_empty());

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
        assert_eq!(data["user"]["soup"]["items"][0]["documentName"], json!("B"));

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
fn incomplete_registered_write_is_conservatively_affected() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query_with_registration(
                Some(1),
                Some(QueryRegistration {
                    op_id: 1,
                    entity_resolvers: &[],
                }),
                NetworkWrite {
                    query: QUERY,
                    operation_name: Some("Soup"),
                    variables: &vars(10),
                    data: &json!({ "user": { "id": "user-1" } }),
                    identity: None,
                },
            )
            .await
            .unwrap();

        let Json::Object(notification_variables) = json!({
            "input": {
                "notificationIds": ["unrelated-notification"],
                "operation": "MARK_SEEN"
            }
        }) else {
            unreachable!()
        };
        let write = engine
            .write_query(
                Some(2),
                UPDATE_NOTIFICATIONS_MUTATION,
                Some("UpdateNotifications"),
                &notification_variables,
                &json!({
                    "updateNotifications": [{
                        "__typename": "GraphqlNotification",
                        "id": "unrelated-notification",
                        "seen": true,
                        "viewedAt": null
                    }]
                }),
                None,
            )
            .await
            .unwrap();
        assert_eq!(write.affected_ops, [1].into());

        engine
            .write_query_with_registration(
                Some(1),
                Some(QueryRegistration {
                    op_id: 1,
                    entity_resolvers: &[],
                }),
                NetworkWrite {
                    query: QUERY,
                    operation_name: Some("Soup"),
                    variables: &vars(10),
                    data: &page(&[("doc-1", "Complete")]),
                    identity: None,
                },
            )
            .await
            .unwrap();
        let write = engine
            .write_query(
                Some(2),
                UPDATE_NOTIFICATIONS_MUTATION,
                Some("UpdateNotifications"),
                &notification_variables,
                &json!({
                    "updateNotifications": [{
                        "__typename": "GraphqlNotification",
                        "id": "another-unrelated-notification",
                        "seen": true,
                        "viewedAt": null
                    }]
                }),
                None,
            )
            .await
            .unwrap();
        assert!(write.affected_ops.is_empty());
    });
}

#[test]
fn channel_activity_and_notification_status_update_separate_normalized_records() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let query_variables = vars(10);
        let initial = json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "items": [{
                        "__typename": "GraphqlSoupChannel",
                        "id": "channel-1",
                        "notifications": [{
                            "__typename": "GraphqlNotification",
                            "id": "notification-1",
                            "seen": false,
                            "viewedAt": null
                        }]
                    }],
                    "nextCursor": null
                }
            }
        });
        engine
            .write_query(
                Some(1),
                CHANNEL_NOTIFICATIONS_QUERY,
                Some("ChannelNotifications"),
                &query_variables,
                &initial,
                None,
            )
            .await
            .unwrap();

        let Json::Object(activity_variables) = json!({
            "input": { "channelId": "channel-1", "activityType": "VIEW" }
        }) else {
            unreachable!()
        };
        engine
            .write_query(
                Some(2),
                RECORD_CHANNEL_ACTIVITY_MUTATION,
                Some("RecordChannelActivity"),
                &activity_variables,
                &json!({
                    "recordChannelActivity": {
                        "__typename": "GraphqlChannelActivity",
                        "id": "activity-1",
                        "channelId": "channel-1",
                        "viewedAt": "2025-01-01T00:00:01Z"
                    }
                }),
                None,
            )
            .await
            .unwrap();

        let ReadResult::Hit { data } = engine
            .read_query(
                Some(1),
                CHANNEL_NOTIFICATIONS_QUERY,
                Some("ChannelNotifications"),
                &query_variables,
            )
            .await
            .unwrap()
        else {
            panic!("expected cached channel after activity mutation");
        };
        assert_eq!(
            data["user"]["soup"]["items"][0]["notifications"][0]["seen"],
            json!(false)
        );

        let Json::Object(notification_variables) = json!({
            "input": {
                "notificationIds": ["notification-1"],
                "operation": "MARK_SEEN"
            }
        }) else {
            unreachable!()
        };
        engine
            .write_query(
                Some(3),
                UPDATE_NOTIFICATIONS_MUTATION,
                Some("UpdateNotifications"),
                &notification_variables,
                &json!({
                    "updateNotifications": [{
                        "__typename": "GraphqlNotification",
                        "id": "notification-1",
                        "seen": true,
                        "viewedAt": "2025-01-01T00:00:02Z"
                    }]
                }),
                None,
            )
            .await
            .unwrap();

        let ReadResult::Hit { data } = engine
            .read_query(
                Some(1),
                CHANNEL_NOTIFICATIONS_QUERY,
                Some("ChannelNotifications"),
                &query_variables,
            )
            .await
            .unwrap()
        else {
            panic!("expected cached channel after notification mutation");
        };
        let notification = &data["user"]["soup"]["items"][0]["notifications"][0];
        assert_eq!(notification["seen"], json!(true));
        assert_eq!(notification["viewedAt"], json!("2025-01-01T00:00:02Z"));
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
        let ops = engine.external_reset().unwrap();
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
                __typename
                id
                ... on GraphqlSoupDocument { documentName: name }
              }
              nextCursor
            }
          }
        }
        "#;
        let partial = json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "items": [
                        { "__typename": "GraphqlSoupDocument", "id": "doc-1", "documentName": "A2" },
                        { "__typename": "GraphqlSoupDocument", "id": "doc-2", "documentName": "B2" },
                        { "__typename": "GraphqlSoupDocument", "id": "doc-3", "documentName": "C2" }
                    ],
                    "nextCursor": null
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
            assert_eq!(item["documentName"], json!(name));
            assert_eq!(item["ownerId"], json!("user-1"));
        }
    });
}
