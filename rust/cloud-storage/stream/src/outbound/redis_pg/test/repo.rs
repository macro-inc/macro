use super::util::StreamGuard;
use crate::domain::StreamRepoExt;
use futures::StreamExt;
use serial_test::serial;
use std::time::Duration;

/// Integration test for RedisStreamService - requires a running Redis instance.
/// Run with: REDIS_URL=redis://localhost:6379 cargo test -p stream -- --ignored
#[tokio::test]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_redis_stream_service_append_and_read() {
    let (service, stream_id, _guard) = StreamGuard::new("append_and_read").await;

    let item1 = serde_json::json!({"message": "hello", "count": 1});
    let item2 = serde_json::json!({"message": "world", "count": 2});

    service
        .append(&stream_id, item1.clone())
        .await
        .expect("Failed to append item1");

    service
        .append(&stream_id, item2.clone())
        .await
        .expect("Failed to append item2");

    service
        .close(&stream_id)
        .await
        .expect("failed to close stream");

    // Read items back from the stream
    let mut stream = service
        .stream_from_beginning(&stream_id)
        .await
        .expect("Failed to create stream");

    let timeout = Duration::from_secs(5);
    let received1 = tokio::time::timeout(timeout, stream.next())
        .await
        .expect("Timeout waiting for item1")
        .expect("Stream ended unexpectedly");

    let received2 = tokio::time::timeout(timeout, stream.next())
        .await
        .expect("Timeout waiting for item2")
        .expect("Stream ended unexpectedly");

    let end = tokio::time::timeout(timeout, stream.next())
        .await
        .expect("Timed out waiting for end");

    assert_eq!(received1.payload, item1);
    assert_eq!(received2.payload, item2);
    assert_eq!(received1.id, stream_id);
    assert_eq!(received2.id, stream_id);
    assert!(end.is_none());
}

#[tokio::test]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_from_async_stream() {
    // Use StreamGuard for cleanup, but get the concrete service for extension trait
    let (service, stream_id, _guard) = StreamGuard::new("from_async_stream").await;

    let items = (1..=5)
        .map(|i| serde_json::json!({"index": i}))
        .collect::<Vec<_>>();

    let input_stream = futures::stream::iter(items.clone());
    service
        .clone()
        .from_async_stream(stream_id.clone(), Box::pin(input_stream), None, None);

    let mut output_stream = service
        .stream_from_beginning(&stream_id)
        .await
        .expect("Failed to create stream");

    let timeout = Duration::from_secs(5);
    for (i, expected) in items.iter().enumerate() {
        let received = tokio::time::timeout(timeout, output_stream.next())
            .await
            .unwrap_or_else(|_| panic!("Timeout waiting for item {}", i + 1))
            .unwrap_or_else(|| panic!("Stream ended unexpectedly at item {}", i + 1));
        assert_eq!(&received.payload, expected, "Mismatch at item {}", i + 1);
    }

    let end = tokio::time::timeout(timeout, output_stream.next())
        .await
        .expect("Timeout waiting for stream end");
    assert!(end.is_none(), "Expected stream to be closed after 5 items");
}

#[tokio::test]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_notify_on_multiple_new_streams() {
    let (_, stream_id1, _guard1) = StreamGuard::new("notify_multi_1").await;
    let (service, stream_id2, _guard2) = StreamGuard::new("notify_multi_2").await;

    let mut notify = service.notify().await;
    let timeout = Duration::from_millis(500);

    // First stream creation - should notify
    service
        .append(&stream_id1, serde_json::json!({"stream": 1}))
        .await
        .expect("Failed to append to stream 1");

    let notified = tokio::time::timeout(timeout, notify.recv())
        .await
        .expect("Timeout waiting for notification on first stream")
        .expect("Notify channel closed");
    assert_eq!(notified.entity_id, stream_id1.entity_id);

    // Second stream creation - should notify
    service
        .append(&stream_id2, serde_json::json!({"stream": 2}))
        .await
        .expect("Failed to append to stream 2");

    let notified = tokio::time::timeout(timeout, notify.recv())
        .await
        .expect("Timeout waiting for notification on second stream")
        .expect("Notify channel closed");
    assert_eq!(notified.entity_id, stream_id2.entity_id);
}

#[tokio::test]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_notify_only_on_new_stream() {
    let (service, stream_id, _guard) = StreamGuard::new("notify_test").await;

    let mut notify = service.notify().await;

    // First append creates a new stream - should notify
    service
        .append(&stream_id, serde_json::json!({"item": 1}))
        .await
        .expect("Failed to append first item");

    let timeout = Duration::from_millis(500);
    let notified_id = tokio::time::timeout(timeout, notify.recv())
        .await
        .expect("Timeout waiting for notification on new stream")
        .expect("Notify channel closed");
    assert_eq!(notified_id.entity_id, stream_id.entity_id);
    assert_eq!(notified_id.stream_id, stream_id.stream_id);

    // Additional appends to same stream - should NOT notify
    for i in 2..=5 {
        service
            .append(&stream_id, serde_json::json!({"item": i}))
            .await
            .unwrap_or_else(|_| panic!("Failed to append item {}", i));
    }

    let result = tokio::time::timeout(timeout, notify.recv()).await;
    assert!(
        result.is_err(),
        "Should not receive notification when appending to existing stream"
    );
}

#[tokio::test]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_active_streams() {
    let entity_id = "active_streams_test_entity";

    // Create two streams with the same entity_id but different stream_ids
    let (service, stream_id1, _guard1) =
        StreamGuard::new_with_stream_id(entity_id, "stream_a").await;
    let (_, stream_id2, _guard2) = StreamGuard::new_with_stream_id(entity_id, "stream_b").await;

    // Append to first stream
    service
        .append(&stream_id1, serde_json::json!({"test": "stream1"}))
        .await
        .expect("Failed to append to stream 1");

    // Append to second stream
    service
        .append(&stream_id2, serde_json::json!({"test": "stream2"}))
        .await
        .expect("Failed to append to stream 2");

    // Query active streams for the entity
    let active = service
        .active_streams(entity_id)
        .await
        .expect("Failed to get active streams");

    // Verify both streams are returned
    assert_eq!(active.len(), 2, "Expected 2 active streams");

    let stream_ids: Vec<&str> = active.iter().map(|s| s.stream_id.as_str()).collect();
    assert!(
        stream_ids.contains(&"stream_a"),
        "Expected stream_a in active streams"
    );
    assert!(
        stream_ids.contains(&"stream_b"),
        "Expected stream_b in active streams"
    );

    // All returned streams should have the correct entity_id
    for stream in &active {
        assert_eq!(stream.entity_id, entity_id);
    }
}

#[tokio::test]
#[serial]
#[ignore = "Redis doesn't exist in CI"]
async fn test_active_streams_empty() {
    let (service, _, _guard) = StreamGuard::new("active_streams_empty").await;

    // Query for a non-existent entity
    let active = service
        .active_streams("nonexistent_entity_12345")
        .await
        .expect("Failed to get active streams");

    assert!(
        active.is_empty(),
        "Expected no active streams for non-existent entity"
    );
}
