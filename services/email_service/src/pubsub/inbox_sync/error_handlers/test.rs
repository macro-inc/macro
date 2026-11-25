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

/// What Postgres answers a statement that gave up waiting for a lock.
#[derive(Debug)]
struct LockTimeout;

impl std::fmt::Display for LockTimeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("canceling statement due to lock timeout")
    }
}

impl std::error::Error for LockTimeout {}

impl sqlx::error::DatabaseError for LockTimeout {
    fn message(&self) -> &str {
        "canceling statement due to lock timeout"
    }
    fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
        Some("55P03".into())
    }
    fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
        self
    }
    fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
        self
    }
    fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
        self
    }
    fn kind(&self) -> sqlx::error::ErrorKind {
        sqlx::error::ErrorKind::Other
    }
}

#[tokio::test]
async fn a_database_failure_keeps_its_chain_and_records_its_sqlstate_on_the_span() {
    use email::domain::mailbox::{DatabaseFailure, MailboxError};

    let data = InboxSyncPubsubMessage {
        link_id: uuid::Uuid::from_u128(1),
        operation: InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
            provider_message_id: "message-1".into(),
        }),
    };
    let failures = [
        (
            anyhow::Error::new(sqlx::Error::Database(Box::new(LockTimeout)))
                .context("Failed to delete message with transaction")
                .context("delete_message"),
            "delete_message: Failed to delete message with transaction: \
             error returned from database: canceling statement due to lock timeout",
        ),
        (
            anyhow::Error::new(MailboxError::database(DatabaseFailure::Sqlstate(
                "55P03".into(),
            )))
            .context("Failed to atomically accept Gmail history and its work")
            .context("gmail_message"),
            "gmail_message: Failed to atomically accept Gmail history and its work: \
             mailbox persistence is unavailable: sqlstate 55P03",
        ),
    ];
    for (source, chain) in failures {
        let error = DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source,
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
        assert!(
            text.contains(r#"db.response.status_code="55P03""#),
            "{text}"
        );
        assert!(
            text.contains(&format!("error=DatabaseQueryFailed: {chain}")),
            "{text}"
        );
    }
}
