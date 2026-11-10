use super::fakes::{Call, input, make_service};
use super::*;
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
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

impl Output {
    fn subscriber(&self) -> impl tracing::Subscriber + Send + Sync + 'static {
        let output = self.clone();
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .without_time()
            .with_ansi(false)
            .with_target(false)
            .with_writer(move || output.clone())
            .finish()
    }
    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

fn assert_debug(output: &Output, text: &str, span: &str) {
    let text_output = output.text();
    let matching = text_output
        .lines()
        .filter(|line| line.contains(text))
        .collect::<Vec<_>>();
    assert_eq!(matching.len(), 1, "{text_output}");
    assert!(matching[0].starts_with("DEBUG "), "{}", matching[0]);
    assert!(matching[0].contains(span), "{}", matching[0]);
}

#[tokio::test]
async fn each_operation_success_has_its_existing_debug_event_inside_the_processing_span() {
    let mut operations = vec![gmail_notification()];
    operations.extend(fanned_out_operations());
    for (operation, text) in operations.into_iter().zip([
        "Successfully processed gmail message operation",
        "Successfully processed upsert message operation",
        "Successfully processed delete message operation",
        "Successfully processed update labels operation",
    ]) {
        let (service, fake) = make_service(false);
        let output = Output::default();
        assert!(matches!(
            service
                .process(Ok(input(operation)), &fake)
                .with_subscriber(output.subscriber())
                .await,
            InboxSyncDisposition::DoneDelete
        ));
        assert_debug(&output, text, "inner_process_message");
    }
}

#[tokio::test]
async fn skipped_and_missing_messages_log_their_existing_debug_fields_once() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().link.as_mut().unwrap().is_sync_active = false;
    let output = Output::default();
    service
        .process(Ok(input(gmail_notification())), &fake)
        .with_subscriber(output.subscriber())
        .await;
    assert_debug(
        &output,
        "Skipping inbox sync operation for link",
        "inner_process_message",
    );
    assert!(output.text().contains("is_sync_active=false"));
    assert!(output.text().contains("needs_reauth=false"));
    assert!(output.text().contains("link_id="));
    for delete in [false, true] {
        let (service, fake) = make_service(false);
        let operation = if delete {
            fake.0.lock().unwrap().message = None;
            InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
                provider_message_id: "message-1".into(),
            })
        } else {
            fake.0.lock().unwrap().provider = Ok(None);
            InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
                provider_message_id: "message-1".into(),
            })
        };
        let output = Output::default();
        service
            .process(Ok(input(operation)), &fake)
            .with_subscriber(output.subscriber())
            .await;
        assert_debug(
            &output,
            if delete {
                "Message not found in Gmail when attempting to delete message"
            } else {
                "Message not found in gmail when attempting to update labels"
            },
            if delete {
                "delete_message"
            } else {
                "update_labels"
            },
        );
        assert!(output.text().contains("provider_message_id=message-1"));
        assert!(output.text().contains("link_id="));
    }
}

#[tokio::test]
async fn defensive_already_deleted_branch_keeps_its_debug_event_and_ids() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().deletion = MessageDeletion::AlreadyDeleted;
    let output = Output::default();
    service
        .process(
            Ok(input(InboxSyncOperation::DeleteMessage(
                DeleteMessagePayload {
                    provider_message_id: "message-1".into(),
                },
            ))),
            &fake,
        )
        .with_subscriber(output.subscriber())
        .await;
    assert_debug(
        &output,
        "Message already deleted by a concurrent operation",
        "delete_message",
    );
    assert!(output.text().contains("message_id="));
    assert!(output.text().contains("link_id="));
    assert!(
        !fake
            .calls()
            .iter()
            .any(|call| matches!(call, Call::Event(_) | Call::Refresh(_)))
    );
}

#[tokio::test]
async fn retry_and_deferred_debug_logs_include_the_original_display_error_and_payload() {
    for retry in [false, true] {
        let (service, fake) = make_service(retry);
        fake.0.lock().unwrap().provider = Err(EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local,
        });
        let outcome = service
            .process(
                Ok(input(InboxSyncOperation::UpdateLabels(
                    UpdateLabelsPayload {
                        provider_message_id: "message-1".into(),
                    },
                ))),
                &fake,
            )
            .await;
        let output = Output::default();
        let (text, span) = if retry {
            let InboxSyncDisposition::LeaveForRedelivery { data, error } = outcome else {
                panic!("retry disposition")
            };
            tracing::subscriber::with_default(output.subscriber(), || {
                tracing::debug_span!("handle_retryable_error")
                    .in_scope(|| record_retryable_error(&data, &error));
            });
            (
                "Retryable error processing inbox sync message.",
                "handle_retryable_error",
            )
        } else {
            let InboxSyncDisposition::FailureDelete { data, error, log } = outcome else {
                panic!("deferred disposition")
            };
            assert!(matches!(log, InboxSyncFailureLog::Deferred));
            tracing::subscriber::with_default(output.subscriber(), || {
                tracing::debug_span!("handle_non_retryable_error")
                    .in_scope(|| log.record(&data, &error));
            });
            (
                "Rate-limited inbox sync message deferred. The message will be deleted.",
                "handle_non_retryable_error",
            )
        };
        assert_debug(&output, text, span);
        assert!(output.text().contains("error="));
        assert!(output.text().contains("remove_labels:"));
        assert!(output.text().contains("payload="));
        assert!(output.text().contains("UpdateLabels"));
        assert!(output.text().contains("message-1"));
    }
}

#[tokio::test]
async fn permanent_failures_keep_the_terminal_error_event() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().provider = Err(EmailApiError::Forbidden);
    let InboxSyncDisposition::FailureDelete { data, error, log } = service
        .process(
            Ok(input(InboxSyncOperation::UpdateLabels(
                UpdateLabelsPayload {
                    provider_message_id: "message-1".into(),
                },
            ))),
            &fake,
        )
        .await
    else {
        panic!("terminal disposition")
    };
    assert!(matches!(log, InboxSyncFailureLog::Permanent));
    let output = Output::default();
    tracing::subscriber::with_default(output.subscriber(), || {
        tracing::debug_span!("handle_non_retryable_error").in_scope(|| log.record(&data, &error));
    });
    let text = output.text();
    assert_eq!(text.lines().count(), 1);
    assert!(
        text.starts_with("ERROR handle_non_retryable_error:"),
        "{text}"
    );
    assert!(text.contains(
        "Non-retryable error processing inbox sync message. The message will be deleted."
    ));
    assert!(text.contains("error="));
    assert!(text.contains("remove_labels:"));
    assert!(text.contains("payload="));
}
