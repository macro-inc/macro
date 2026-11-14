use super::*;
use models_email::gmail::inbox_sync::{DeleteMessagePayload, InboxSyncOperation};
use models_email::service::pubsub::FailureReason;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tracing::instrument::WithSubscriber;

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<u8>>>);

impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn retryable_listener_emits_its_debug_event_once_with_span_error_and_payload() {
    let data = InboxSyncPubsubMessage {
        link_id: uuid::Uuid::from_u128(1),
        operation: InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
            provider_message_id: "message-1".into(),
        }),
    };
    let error = DetailedError {
        reason: FailureReason::DatabaseQueryFailed,
        source: anyhow::anyhow!("delete_message: database unavailable"),
    };
    let output = Output::default();
    let writer = output.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .without_time()
        .with_ansi(false)
        .with_target(false)
        .with_writer(move || writer.clone())
        .finish();
    handle_retryable_error(&data, &error)
        .with_subscriber(subscriber)
        .await
        .unwrap();
    let text = String::from_utf8(output.0.lock().unwrap().clone()).unwrap();
    assert_eq!(
        text.matches("Retryable error processing inbox sync message.")
            .count(),
        1
    );
    assert!(text.starts_with("DEBUG handle_retryable_error{"), "{text}");
    assert!(text.contains("data=InboxSyncPubsubMessage"), "{text}");
    assert!(text.contains("e=DetailedError"), "{text}");
    assert!(text.contains("error="), "{text}");
    assert!(text.contains("payload="), "{text}");
    assert!(
        text.contains("delete_message: database unavailable"),
        "{text}"
    );
    assert!(text.contains("message-1"), "{text}");
}
