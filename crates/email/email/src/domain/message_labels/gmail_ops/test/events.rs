use super::*;
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

fn subscriber(output: &Output) -> impl tracing::Subscriber + Send + Sync + 'static {
    let output = output.clone();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .without_time()
        .with_ansi(false)
        .with_target(false)
        .with_writer(move || output.clone())
        .finish()
}

#[tokio::test]
async fn retryable_outcome_emits_one_debug_event_with_error_and_payload_in_its_handler_span() {
    let (service, fake) = make_service(true);
    fake.0.lock().unwrap().fault = Some("link");
    let GmailOpsDisposition::LeaveForRedelivery { data, error } =
        service.process(Ok(message(1, true))).await
    else {
        panic!("database failure must retain the retry delivery");
    };
    let output = Output::default();
    tracing::subscriber::with_default(subscriber(&output), || {
        tracing::debug_span!("handle_retryable_error")
            .in_scope(|| record_retryable_error(&data, &error));
    });
    assert_eq!(
        String::from_utf8(output.0.lock().unwrap().clone()).unwrap(),
        format!(
            "DEBUG handle_retryable_error: Retryable error processing gmail ops message. error={error:?} payload={:?}\n",
            data.operation
        )
    );
}

#[tokio::test]
async fn deferred_outcome_emits_one_debug_event_with_error_and_payload_in_its_handler_span() {
    let (service, fake) = make_service(false);
    fake.0
        .lock()
        .unwrap()
        .replies
        .push_back(Err(EmailApiError::Transient {
            message: "provider unavailable".into(),
        }));
    let GmailOpsDisposition::FailureDelete { data, error, log } =
        service.process(Ok(message(1, true))).await
    else {
        panic!("primary transient failure must move to the retry queue");
    };
    assert!(matches!(log, GmailOpsFailureLog::Deferred));
    let output = Output::default();
    tracing::subscriber::with_default(subscriber(&output), || {
        tracing::debug_span!("handle_non_retryable_error").in_scope(|| log.record(&data, &error));
    });
    assert_eq!(
        String::from_utf8(output.0.lock().unwrap().clone()).unwrap(),
        format!(
            "DEBUG handle_non_retryable_error: Deferred gmail ops message moved to the retry queue. The message will be deleted. error={error:?} payload={:?}\n",
            data.operation
        )
    );
}

#[tokio::test]
async fn successful_outcome_emits_one_debug_event_with_the_operation_in_its_processing_span() {
    let (service, _) = make_service(false);
    let output = Output::default();
    assert!(matches!(
        service
            .process(Ok(message(1, true)))
            .with_subscriber(subscriber(&output))
            .await,
        GmailOpsDisposition::DoneDelete
    ));
    assert_eq!(
        String::from_utf8(output.0.lock().unwrap().clone()).unwrap(),
        "DEBUG inner_process_message: Successfully processed Gmail operation operation_name=\"modify_message_labels\"\n"
    );
}
