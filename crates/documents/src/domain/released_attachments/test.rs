use super::*;
use macro_event_broker::{EventBrokerError, MacroEvent};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

#[derive(Debug, thiserror::Error)]
#[error("queue unavailable")]
struct QueueUnavailable;

/// Hands out the scripted batches in order, then empty ones.
struct ScriptedQueue {
    batches: Mutex<VecDeque<Result<ReleasedBatch, QueueUnavailable>>>,
    limits: Mutex<Vec<u32>>,
}

impl ScriptedQueue {
    fn new(batches: Vec<Result<ReleasedBatch, QueueUnavailable>>) -> Self {
        Self {
            batches: Mutex::new(batches.into()),
            limits: Mutex::new(Vec::new()),
        }
    }
}

impl ReleasedAttachmentRepo for ScriptedQueue {
    type Err = QueueUnavailable;

    async fn trash_released_batch(&self, limit: u32) -> Result<ReleasedBatch, Self::Err> {
        self.limits.lock().expect("limits lock").push(limit);
        self.batches
            .lock()
            .expect("batches lock")
            .pop_front()
            .unwrap_or_else(|| Ok(ReleasedBatch::default()))
    }

    async fn queue(&self) -> Result<ReleaseQueue, Self::Err> {
        Ok(ReleaseQueue {
            depth: 3,
            oldest_age_seconds: Some(12),
        })
    }
}

#[derive(Clone, Default)]
struct RecordingBroker(Arc<Mutex<Vec<(String, serde_json::Value)>>>);

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.0.lock().expect("events lock").push((
            event.key().to_string(),
            serde_json::to_value(event.event())?,
        ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

impl RecordingBroker {
    /// Each event's key, type and metadata: the wire contract consumers read.
    fn published(&self) -> Vec<(String, serde_json::Value, serde_json::Value)> {
        self.0
            .lock()
            .expect("events lock")
            .iter()
            .map(|(key, event)| {
                (
                    key.clone(),
                    event["event_type"].clone(),
                    event["metadata"].clone(),
                )
            })
            .collect()
    }
}

#[tokio::test]
async fn each_batch_that_releases_documents_publishes_one_event_naming_them() {
    let queue = ScriptedQueue::new(vec![
        Ok(ReleasedBatch {
            claimed: 3,
            trashed: vec!["a".into(), "b".into()],
            kept: vec!["k".into()],
            adopted: 1,
            ..Default::default()
        }),
        Ok(ReleasedBatch {
            claimed: 2,
            relinked: 1,
            missing: 1,
            ..Default::default()
        }),
        // Kept documents alone still stop being attachments, so they publish.
        Ok(ReleasedBatch {
            claimed: 1,
            kept: vec!["in-trash".into()],
            ..Default::default()
        }),
        Ok(ReleasedBatch {
            claimed: 1,
            trashed: vec!["c".into()],
            ..Default::default()
        }),
    ]);
    let broker = RecordingBroker::default();
    let service = ReleasedAttachmentService::new(queue, broker.clone());

    let trashed = service.drain().await.expect("drain");

    assert_eq!(trashed, 3);
    let released = serde_json::json!("document.email_attachments_released");
    assert_eq!(
        broker.published(),
        vec![
            (
                "a".to_string(),
                released.clone(),
                serde_json::json!({
                    "trashed_document_ids": ["a", "b"],
                    "kept_document_ids": ["k"],
                }),
            ),
            (
                "in-trash".to_string(),
                released.clone(),
                serde_json::json!({
                    "trashed_document_ids": [],
                    "kept_document_ids": ["in-trash"],
                }),
            ),
            (
                "c".to_string(),
                released,
                serde_json::json!({
                    "trashed_document_ids": ["c"],
                    "kept_document_ids": [],
                }),
            ),
        ]
    );
    // Four batches with rows, then the empty claim that ends the drain.
    assert_eq!(
        *service.repo.limits.lock().expect("limits lock"),
        vec![RELEASE_BATCH_SIZE; 5]
    );
}

#[tokio::test]
async fn a_failed_batch_stops_the_drain_after_the_batches_before_it() {
    let queue = ScriptedQueue::new(vec![
        Ok(ReleasedBatch {
            claimed: 1,
            trashed: vec!["a".into()],
            ..Default::default()
        }),
        Err(QueueUnavailable),
    ]);
    let broker = RecordingBroker::default();
    let service = ReleasedAttachmentService::new(queue, broker.clone());

    assert!(service.drain().await.is_err());
    assert_eq!(broker.published().len(), 1);
}

#[tokio::test]
async fn a_drain_stops_after_its_batch_limit_and_leaves_the_rest_queued() {
    let full = || {
        Ok(ReleasedBatch {
            claimed: 1,
            trashed: vec!["a".into()],
            ..Default::default()
        })
    };
    let queue = ScriptedQueue::new((0..DRAIN_BATCH_LIMIT + 1).map(|_| full()).collect());
    let broker = RecordingBroker::default();
    let service = ReleasedAttachmentService::new(queue, broker.clone());

    let trashed = service.drain().await.expect("drain");

    assert_eq!(trashed, DRAIN_BATCH_LIMIT);
    assert_eq!(
        service.repo.limits.lock().expect("limits lock").len(),
        DRAIN_BATCH_LIMIT
    );
    assert_eq!(service.repo.batches.lock().expect("batches lock").len(), 1);
}
