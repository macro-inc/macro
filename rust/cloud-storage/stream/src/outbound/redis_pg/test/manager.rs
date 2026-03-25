use super::util::StreamGuard;
use crate::domain::{StreamId, StreamManager, StreamRepoExt};
use crate::outbound::redis_pg::*;
use futures::StreamExt;
use serial_test::serial;
use std::sync::Arc;
use std::time::Duration;

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_no_streams() {
    let (service, _stream_id, _guard) = StreamGuard::new("manager_no_streams").await;
    let manager = RedisPostgresStreamManager::new(service);

    let mut stream = manager
        .subscribe("sender_1".into(), "entity_1".into())
        .await
        .expect("subscribe should succeed");

    // No messages should be received since there are no streams
    let result = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
    assert!(result.is_err(), "should timeout with no messages");
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_sub_then_start_related() {
    let entity_id = "manager_sub_then_start";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;
    let manager = RedisPostgresStreamManager::new(service.clone());

    let mut stream = manager
        .subscribe("sender_1".into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Now create a stream by appending to it
    let item = serde_json::json!({"message": "hello from stream"});
    service
        .append(&stream_id, item.clone())
        .await
        .expect("append should succeed");

    // The subscriber should receive the item via the notification mechanism
    let received = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("should receive message")
        .expect("stream should not be closed");

    assert_eq!(received.payload, item);
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_sub_then_start_unrelated() {
    let (service, stream_id, _guard) = StreamGuard::new("manager_unrelated_entity").await;
    let manager = RedisPostgresStreamManager::new(service.clone());

    let mut stream = manager
        .subscribe("sender_1".into(), "different_entity".into())
        .await
        .expect("subscribe should succeed");

    tokio::time::sleep(Duration::from_millis(50)).await;

    // Create a stream on a different entity than we subscribed to
    let item = serde_json::json!({"message": "should not receive"});
    service
        .append(&stream_id, item)
        .await
        .expect("append should succeed");

    // Subscriber should NOT receive anything
    let result = tokio::time::timeout(Duration::from_millis(500), stream.next()).await;
    assert!(
        result.is_err(),
        "should timeout - no messages for unrelated entity"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_start_then_sub() {
    let entity_id = "manager_start_then_sub";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;

    // Create the stream and add items BEFORE subscribing
    let item1 = serde_json::json!({"message": "first"});
    let item2 = serde_json::json!({"message": "second"});

    service
        .append(&stream_id, item1.clone())
        .await
        .expect("append should succeed");
    service
        .append(&stream_id, item2.clone())
        .await
        .expect("append should succeed");

    // Now create manager and subscribe
    let manager = RedisPostgresStreamManager::new(service.clone());

    let mut stream = manager
        .subscribe("sender_1".into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Should receive both items that were already in the stream
    let received1 = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("should receive first message")
        .expect("stream should not be closed");
    assert_eq!(received1.payload, item1);

    let received2 = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("should receive second message")
        .expect("stream should not be closed");
    assert_eq!(received2.payload, item2);
}

// =============================================================================
// Late join tests
// =============================================================================

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_late_join_multiple_streams_same_entity() {
    let entity_id = "late_join_multi_streams";
    let (service, stream_id_1, guard) = StreamGuard::new(entity_id).await;

    // Create a second stream for the same entity
    let stream_id_2 = StreamId {
        entity_id: entity_id.into(),
        entity_type: model_entity::EntityType::Chat,
        stream_id: format!("{}_stream_2", entity_id),
    };
    guard.add_stream_id(stream_id_2.clone());

    // Add items to first stream
    service
        .append(&stream_id_1, serde_json::json!({"stream": 1, "seq": 1}))
        .await
        .expect("append should succeed");
    service
        .append(&stream_id_1, serde_json::json!({"stream": 1, "seq": 2}))
        .await
        .expect("append should succeed");

    // Add items to second stream
    service
        .append(&stream_id_2, serde_json::json!({"stream": 2, "seq": 1}))
        .await
        .expect("append should succeed");
    service
        .append(&stream_id_2, serde_json::json!({"stream": 2, "seq": 2}))
        .await
        .expect("append should succeed");

    // Late join - subscribe after both streams have data
    let manager = RedisPostgresStreamManager::new(service.clone());

    let mut stream = manager
        .subscribe("sender_1".into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Collect all received items
    let mut received = Vec::new();
    while let Ok(Some(item)) = tokio::time::timeout(Duration::from_millis(500), stream.next()).await
    {
        received.push(item.payload.clone());
    }

    // Should receive items from both streams (4 total)
    assert_eq!(
        received.len(),
        4,
        "should receive all items from both streams"
    );

    // Count items per stream
    let stream1_count = received.iter().filter(|i| i["stream"] == 1).count();
    let stream2_count = received.iter().filter(|i| i["stream"] == 2).count();

    assert_eq!(stream1_count, 2, "should get 2 items from stream 1");
    assert_eq!(stream2_count, 2, "should get 2 items from stream 2");
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_late_join_during_active_streaming() {
    let entity_id = "late_join_active";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;

    // Add initial items before any subscriber
    service
        .append(&stream_id, serde_json::json!({"phase": "before", "seq": 1}))
        .await
        .expect("append should succeed");
    service
        .append(&stream_id, serde_json::json!({"phase": "before", "seq": 2}))
        .await
        .expect("append should succeed");

    let manager = RedisPostgresStreamManager::new(service.clone());

    // First subscriber joins
    let mut stream1 = manager
        .subscribe("sender_1".into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Wait for first subscriber to get initial items
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Add more items while first subscriber is connected
    service
        .append(&stream_id, serde_json::json!({"phase": "during", "seq": 3}))
        .await
        .expect("append should succeed");

    // Second subscriber joins mid-stream
    let mut stream2 = manager
        .subscribe("sender_2".into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Add more items after second subscriber
    service
        .append(&stream_id, serde_json::json!({"phase": "after", "seq": 4}))
        .await
        .expect("append should succeed");
    service
        .append(&stream_id, serde_json::json!({"phase": "after", "seq": 5}))
        .await
        .expect("append should succeed");

    // Collect items from both streams
    async fn collect_items(stream: &mut crate::domain::ItemStream) -> Vec<serde_json::Value> {
        let mut received = Vec::new();
        while let Ok(Some(item)) =
            tokio::time::timeout(Duration::from_millis(500), stream.next()).await
        {
            received.push(item.payload.clone());
        }
        received
    }

    let early_received = collect_items(&mut stream1).await;
    let late_received = collect_items(&mut stream2).await;

    // First subscriber should get all 5 items
    assert_eq!(
        early_received.len(),
        5,
        "early subscriber should get all 5 items"
    );

    // Second subscriber should also get all 5 items (stream_from_beginning)
    assert_eq!(
        late_received.len(),
        5,
        "late subscriber should get all 5 items from beginning"
    );

    // Verify late subscriber got items in correct order
    for (i, item) in late_received.iter().enumerate() {
        assert_eq!(
            item["seq"],
            i + 1,
            "late subscriber items should be in order"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_unsub_during_stream() {
    let entity_id = "manager_unsub_during";
    let sender_id = "sender_unsub";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;
    let manager = RedisPostgresStreamManager::new(service.clone());

    // Create stream with initial item
    let item1 = serde_json::json!({"seq": 1});
    service
        .append(&stream_id, item1.clone())
        .await
        .expect("append should succeed");

    let mut stream = manager
        .subscribe(sender_id.into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Receive first item
    let received = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("should receive message")
        .expect("stream should not be closed");
    assert_eq!(received.payload, item1);

    // Unsubscribe via the manager
    manager
        .unsubscribe(sender_id.into(), entity_id.into())
        .await
        .expect("unsubscribe should succeed");

    // Stream should terminate
    let result = tokio::time::timeout(Duration::from_millis(500), stream.next()).await;
    assert!(
        matches!(result, Ok(None)),
        "stream should end after unsubscribe"
    );

    // Append more items — should not panic
    service
        .append(&stream_id, serde_json::json!({"seq": 2}))
        .await
        .expect("append should succeed");
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_unsub_no_items_after() {
    let entity_id = "manager_unsub_no_items_after";
    let sender_id = "sender_unsub_no_items";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;
    let manager = RedisPostgresStreamManager::new(service.clone());

    service
        .append(&stream_id, serde_json::json!({"seq": 1}))
        .await
        .expect("append should succeed");

    let mut stream = manager
        .subscribe(sender_id.into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Confirm subscription is live
    let received = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("should receive message")
        .expect("stream should not be closed");
    assert_eq!(received.payload, serde_json::json!({"seq": 1}));

    // Unsubscribe
    manager
        .unsubscribe(sender_id.into(), entity_id.into())
        .await
        .expect("unsubscribe should succeed");

    // Stream must yield None (terminated)
    let terminated = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("stream should resolve, not hang");
    assert!(terminated.is_none(), "stream should end after unsubscribe");

    // Append items *after* the stream has ended
    for i in 2..=10 {
        service
            .append(&stream_id, serde_json::json!({"seq": i}))
            .await
            .expect("append should succeed");
    }

    // Drain anything remaining — nothing should come through
    let mut leaked = Vec::new();
    while let Ok(Some(item)) = tokio::time::timeout(Duration::from_millis(500), stream.next()).await
    {
        leaked.push(item.payload);
    }
    assert!(
        leaked.is_empty(),
        "no items should arrive after unsubscribe, but got: {leaked:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_connection_closed() {
    // Unsubscribing and re-subscribing should work fine

    let entity_id = "manager_connection_closed";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;
    let manager = RedisPostgresStreamManager::new(service.clone());

    // Subscribe and immediately unsubscribe
    let _stream = manager
        .subscribe("sender_1".into(), entity_id.into())
        .await
        .expect("subscribe should succeed");
    manager
        .unsubscribe("sender_1".into(), entity_id.into())
        .await
        .expect("unsubscribe should succeed");

    // Append data
    service
        .append(&stream_id, serde_json::json!({"test": "data"}))
        .await
        .expect("append should succeed");

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Re-subscribe should work
    let mut stream2 = manager
        .subscribe("sender_2".into(), entity_id.into())
        .await
        .expect("new subscribe should succeed");

    // Should receive the item from stream_from_beginning
    let received = tokio::time::timeout(Duration::from_secs(2), stream2.next())
        .await
        .expect("should receive message")
        .expect("stream should not be closed");

    assert_eq!(received.payload, serde_json::json!({"test": "data"}));
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_stream_ends_close() {
    // Stream emits items then closes — all items should be received

    let entity_id = "state_stream_ends";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;

    // Create stream first
    service
        .append(&stream_id, serde_json::json!({"seq": 1}))
        .await
        .expect("append should succeed");

    let manager = RedisPostgresStreamManager::new(service.clone());

    let mut stream = manager
        .subscribe("sender_1".into(), entity_id.into())
        .await
        .expect("subscribe should succeed");

    // Emit more items
    service
        .append(&stream_id, serde_json::json!({"seq": 2}))
        .await
        .expect("append should succeed");
    service
        .append(&stream_id, serde_json::json!({"seq": 3}))
        .await
        .expect("append should succeed");

    // End the stream
    service
        .close(&stream_id)
        .await
        .expect("close should succeed");

    // Drain and count
    let mut count = 0;
    while let Ok(Some(_)) = tokio::time::timeout(Duration::from_millis(500), stream.next()).await {
        count += 1;
    }

    assert_eq!(count, 3, "should receive all 3 items");
}

async fn util_test_stream_exhausted(
    stream_id: StreamId,
    service: Arc<dyn crate::domain::StreamRepo>,
) {
    let entity_id = stream_id.entity_id.clone();

    let manager = RedisPostgresStreamManager::new(service.clone());

    let mut stream = manager
        .subscribe(entity_id.clone(), entity_id.clone())
        .await
        .expect("subscribe should succeed");

    // Create a finite stream with 3 items using from_async_stream
    let items: Vec<serde_json::Value> = (1..=3).map(|i| serde_json::json!({"seq": i})).collect();
    let input_stream = futures::stream::iter(items.clone());

    service.from_async_stream(stream_id.clone(), Box::pin(input_stream), None);

    let mut count = 0;
    while let Ok(Some(_)) = tokio::time::timeout(Duration::from_millis(1000), stream.next()).await {
        count += 1;
    }
    assert_eq!(count, 3, "should receive all 3 items");
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_stream_exhausted_single() {
    let entity_id = "state_stream_exhausted_single";
    let (service, stream_id, _guard) = StreamGuard::new(entity_id).await;
    util_test_stream_exhausted(stream_id, service).await;
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_stream_exhausted_load() {
    let (service, _, guard) = StreamGuard::new("load_test_init").await;

    let tests = (0..50).map(|i| {
        let id = format!("exaust_load_{}", i);
        let stream_id = StreamId {
            entity_id: id.clone(),
            entity_type: model_entity::EntityType::Chat,
            stream_id: id.clone(),
        };
        guard.add_stream_id(stream_id.clone());

        util_test_stream_exhausted(stream_id, service.clone())
    });

    futures::future::join_all(tests).await;
}
