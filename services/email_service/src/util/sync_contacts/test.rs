use std::sync::Mutex;

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use serde_json::{Value, json};

use super::*;

#[derive(Clone, Debug)]
struct PublishedEvent {
    topic: String,
    key: String,
    envelope: Value,
}

#[derive(Default)]
struct RecordingEventBroker {
    published: Mutex<Vec<PublishedEvent>>,
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published
            .lock()
            .expect("published events lock should not be poisoned")
            .push(PublishedEvent {
                topic: event.topic().to_string(),
                key: event.key().to_string(),
                envelope: serde_json::to_value(event.event())?,
            });

        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid owner")
}

fn thread_ids(count: usize) -> Vec<Uuid> {
    (1..=count)
        .map(|value| Uuid::from_u128(value as u128))
        .collect()
}

fn assert_published_batches(thread_count: usize, expected_batch_sizes: &[usize]) {
    let broker = RecordingEventBroker::default();
    let link_id = Uuid::from_u128(u128::MAX);
    let owner = owner();
    let thread_ids = thread_ids(thread_count);

    publish_thread_reindex_batches(&broker, link_id, &owner, &thread_ids);

    let published = broker
        .published
        .lock()
        .expect("published events lock should not be poisoned");
    let actual_batch_sizes: Vec<usize> = published
        .iter()
        .map(|event| {
            event.envelope["metadata"]["thread_ids"]
                .as_array()
                .expect("thread_ids should be an array")
                .len()
        })
        .collect();
    assert_eq!(actual_batch_sizes, expected_batch_sizes);

    let published_thread_ids: Vec<Uuid> = published
        .iter()
        .flat_map(|event| {
            assert_eq!(event.topic, "macro.email");
            assert_eq!(event.key, link_id.to_string());
            assert_eq!(event.envelope["schema_version"], json!(1));
            assert_eq!(
                event.envelope["event_type"],
                json!("email.threads_reindex_requested")
            );
            assert_eq!(
                event.envelope["metadata"]["link_id"],
                json!(link_id.to_string())
            );
            assert_eq!(
                event.envelope["metadata"]["owner"],
                json!(owner.to_string())
            );
            assert_eq!(
                event.envelope["metadata"]["reason"],
                json!("contacts_changed")
            );

            let batch = event.envelope["metadata"]["thread_ids"]
                .as_array()
                .expect("thread_ids should be an array");
            assert!(!batch.is_empty());
            assert!(batch.len() <= REINDEX_BATCH_SIZE);

            batch.iter().map(|thread_id| {
                Uuid::parse_str(thread_id.as_str().expect("thread id should be a string"))
                    .expect("thread id should be a UUID")
            })
        })
        .collect();

    assert_eq!(published_thread_ids, thread_ids);
}

#[tokio::test]
async fn publishes_no_batches_for_zero_threads() {
    assert_published_batches(0, &[]);
}

#[tokio::test]
async fn publishes_one_batch_for_one_thread() {
    assert_published_batches(1, &[1]);
}

#[tokio::test]
async fn publishes_one_full_batch_for_fifty_threads() {
    assert_published_batches(50, &[50]);
}

#[tokio::test]
async fn publishes_a_second_batch_for_fifty_one_threads() {
    assert_published_batches(51, &[50, 1]);
}

#[tokio::test]
async fn publishes_ordered_bounded_batches_for_larger_inputs() {
    assert_published_batches(137, &[50, 50, 37]);
}
