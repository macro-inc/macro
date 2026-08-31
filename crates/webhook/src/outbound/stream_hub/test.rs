use super::*;
use crate::domain::models::NormalizedWebhookEvent;
use crate::domain::stream::StreamAudience;
use chrono::{TimeZone as _, Utc};
use entity_access::domain::models::EntityType;
use uuid::{NoContext, Timestamp, Uuid};

fn candidate_at(unix_ms: i64, entity_id: &str) -> StreamCandidateEvent {
    let seconds = u64::try_from(unix_ms / 1_000).expect("non-negative timestamp");
    let nanoseconds = u32::try_from(unix_ms % 1_000).expect("millisecond remainder") * 1_000_000;
    let event_id = Uuid::new_v7(Timestamp::from_unix(NoContext, seconds, nanoseconds));
    StreamCandidateEvent {
        event: NormalizedWebhookEvent {
            event_id: event_id.to_string(),
            schema_version: 1,
            event_name: "document.updated".to_string(),
            entity_type: "document".to_string(),
            entity_id: entity_id.to_string(),
            ordering_key: entity_id.to_string(),
            occurred_at: Utc.timestamp_millis_opt(unix_ms).unwrap(),
            broker_envelope: serde_json::json!({}),
        },
        audience: StreamAudience::Entity {
            entity_id: entity_id.to_string(),
            entity_type: EntityType::Document,
        },
    }
}

#[tokio::test]
async fn cursor_source_replays_full_history_then_live_events() {
    let hub = WebhookStreamHub::new();
    hub.publish(candidate_at(1_000, "before"));
    let cursor = candidate_at(2_000, "cursor");
    let cursor_id = Uuid::parse_str(&cursor.event.event_id).unwrap();
    hub.publish(cursor);

    let mut source = hub
        .open(StreamStart::AtEvent {
            event_id: cursor_id,
        })
        .await
        .unwrap();
    hub.publish(candidate_at(3_000, "live"));

    assert_eq!(source.next_event().await.unwrap().event.entity_id, "before");
    assert_eq!(source.next_event().await.unwrap().event.entity_id, "cursor");
    assert_eq!(source.next_event().await.unwrap().event.entity_id, "live");
}

#[tokio::test]
async fn latest_source_receives_only_events_published_after_open() {
    let hub = WebhookStreamHub::new();
    hub.publish(candidate_at(1_000, "old"));
    let mut source = hub.open(StreamStart::Latest).await.unwrap();
    hub.publish(candidate_at(2_000, "live"));

    assert_eq!(source.next_event().await.unwrap().event.entity_id, "live");
}

#[tokio::test]
async fn push_evicts_expired_events_from_the_front() {
    let hub = WebhookStreamHub::with_retention(Duration::from_secs(10));
    let now = Instant::now();
    let mut replay = hub
        .inner
        .replay
        .lock()
        .expect("replay buffer lock poisoned");
    replay.push(
        candidate_at(12_000, "expired"),
        now - Duration::from_secs(11),
    );
    replay.push(candidate_at(1_000, "retained"), now);

    assert_eq!(replay.events.len(), 1);
    assert_eq!(replay.events[0].candidate.event.entity_id, "retained");
}

#[tokio::test]
async fn duplicate_event_ids_are_published_once() {
    let hub = WebhookStreamHub::new();
    let candidate = candidate_at(1_000, "document");
    hub.publish(candidate.clone());
    hub.publish(candidate);

    let replay = hub
        .inner
        .replay
        .lock()
        .expect("replay buffer lock poisoned");
    assert_eq!(replay.events.len(), 1);
}

#[tokio::test]
async fn open_rejects_truncated_history() {
    let hub = WebhookStreamHub::new();
    hub.publish(candidate_at(2_000, "document"));
    let missing_id = Uuid::parse_str(&candidate_at(1_000, "missing").event.event_id).unwrap();
    assert!(matches!(
        hub.open(StreamStart::AtEvent {
            event_id: missing_id,
        })
        .await,
        Err(WebhookStreamSourceOpenError::ReplayUnavailable)
    ));
}
