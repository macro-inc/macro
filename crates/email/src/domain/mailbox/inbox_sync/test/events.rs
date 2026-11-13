use super::fakes::{Call, LINK, MESSAGE, THREAD, input, label, make_service};
use super::*;
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::instrument::WithSubscriber;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;

#[derive(Clone, Debug)]
struct Captured {
    level: tracing::Level,
    message: String,
    fields: BTreeMap<String, String>,
    spans: Vec<&'static str>,
}

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<Captured>>>);

#[derive(Default)]
struct Fields(BTreeMap<String, String>);

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().into(), value.into());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().into(), format!("{value:?}"));
    }
}

struct Capture(Output);

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> tracing_subscriber::Layer<S> for Capture {
    fn on_event(&self, event: &tracing::Event<'_>, ctx: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        let message = fields.0.remove("message").unwrap_or_default();
        let spans = ctx
            .event_scope(event)
            .map(|scope| {
                scope
                    .from_root()
                    .map(|span| span.metadata().name())
                    .collect()
            })
            .unwrap_or_default();
        self.0.0.lock().unwrap().push(Captured {
            level: *event.metadata().level(),
            message,
            fields: fields.0,
            spans,
        });
    }
}

impl Output {
    fn subscriber(&self) -> impl tracing::Subscriber + Send + Sync + 'static {
        tracing_subscriber::registry()
            .with(tracing_subscriber::filter::LevelFilter::TRACE)
            .with(Capture(self.clone()))
    }
}

fn assert_event(
    output: &Output,
    level: tracing::Level,
    message: &str,
    span: &str,
    fields: impl IntoIterator<Item = (&'static str, String)>,
) {
    let records = output.0.lock().unwrap();
    let matching: Vec<_> = records
        .iter()
        .filter(|event| event.message == message)
        .collect();
    assert_eq!(matching.len(), 1, "{records:?}");
    assert_eq!(matching[0].level, level);
    assert!(
        matching[0].spans.iter().any(|name| *name == span),
        "{:?}",
        matching[0]
    );
    assert_eq!(
        matching[0].fields,
        fields
            .into_iter()
            .map(|(name, value)| (name.into(), value))
            .collect()
    );
}

#[tokio::test]
async fn each_operation_success_has_its_existing_debug_event_inside_the_processing_span() {
    let mut operations = vec![gmail_notification()];
    operations.extend(fanned_out_operations());
    for (operation, message) in operations.into_iter().zip([
        "Successfully processed gmail message operation",
        "Successfully processed upsert message operation",
        "Successfully processed delete message operation",
        "Successfully processed update labels operation",
    ]) {
        let (service, _) = make_service(false);
        let output = Output::default();
        assert!(matches!(
            service
                .process(Ok(input(operation)))
                .with_subscriber(output.subscriber())
                .await,
            InboxSyncDisposition::DoneDelete
        ));
        assert_event(
            &output,
            tracing::Level::DEBUG,
            message,
            "inner_process_message",
            [],
        );
    }
}

#[tokio::test]
async fn skipped_and_missing_messages_log_their_existing_debug_fields_once() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().link.as_mut().unwrap().is_sync_active = false;
    let output = Output::default();
    service
        .process(Ok(input(gmail_notification())))
        .with_subscriber(output.subscriber())
        .await;
    assert_event(
        &output,
        tracing::Level::DEBUG,
        "Skipping inbox sync operation for link",
        "inner_process_message",
        [
            ("link_id", LINK.to_string()),
            ("is_sync_active", "false".into()),
            ("needs_reauth", "false".into()),
        ],
    );
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
            .process(Ok(input(operation)))
            .with_subscriber(output.subscriber())
            .await;
        assert_event(
            &output,
            tracing::Level::DEBUG,
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
            [
                ("provider_message_id", "message-1".into()),
                ("link_id", LINK.to_string()),
            ],
        );
    }
}

#[tokio::test]
async fn defensive_already_deleted_branch_keeps_its_debug_event_and_ids() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().deletion = MessageDeletion::AlreadyDeleted;
    let output = Output::default();
    service
        .process(Ok(input(InboxSyncOperation::DeleteMessage(
            DeleteMessagePayload {
                provider_message_id: "message-1".into(),
            },
        ))))
        .with_subscriber(output.subscriber())
        .await;
    assert_event(
        &output,
        tracing::Level::DEBUG,
        "Message already deleted by a concurrent operation",
        "delete_message",
        [
            ("message_id", MESSAGE.to_string()),
            ("link_id", LINK.to_string()),
        ],
    );
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
            .process(Ok(input(InboxSyncOperation::UpdateLabels(
                UpdateLabelsPayload {
                    provider_message_id: "message-1".into(),
                },
            ))))
            .await;
        let output = Output::default();
        let (message, span, fields) = if retry {
            let InboxSyncDisposition::LeaveForRedelivery { data, error } = outcome else {
                panic!("retry disposition")
            };
            let fields = [
                ("error", error.to_string()),
                ("payload", format!("{:?}", data.operation)),
            ];
            tracing::subscriber::with_default(output.subscriber(), || {
                tracing::debug_span!("handle_retryable_error")
                    .in_scope(|| record_retryable_error(&data, &error));
            });
            (
                "Retryable error processing inbox sync message.",
                "handle_retryable_error",
                fields,
            )
        } else {
            let InboxSyncDisposition::FailureDelete { data, error, log } = outcome else {
                panic!("deferred disposition")
            };
            assert!(matches!(log, InboxSyncFailureLog::Deferred));
            let fields = [
                ("error", error.to_string()),
                ("payload", format!("{:?}", data.operation)),
            ];
            tracing::subscriber::with_default(output.subscriber(), || {
                tracing::debug_span!("handle_non_retryable_error")
                    .in_scope(|| log.record(&data, &error));
            });
            (
                "Deferred inbox sync message moved to the retry queue. The message will be deleted.",
                "handle_non_retryable_error",
                fields,
            )
        };
        assert_event(&output, tracing::Level::DEBUG, message, span, fields);
    }
}

#[tokio::test]
async fn permanent_failures_keep_the_terminal_error_event() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().provider = Err(EmailApiError::Forbidden);
    let InboxSyncDisposition::FailureDelete { data, error, log } = service
        .process(Ok(input(InboxSyncOperation::UpdateLabels(
            UpdateLabelsPayload {
                provider_message_id: "message-1".into(),
            },
        ))))
        .await
    else {
        panic!("terminal disposition")
    };
    assert!(matches!(log, InboxSyncFailureLog::Permanent));
    let output = Output::default();
    tracing::subscriber::with_default(output.subscriber(), || {
        tracing::debug_span!("handle_non_retryable_error").in_scope(|| log.record(&data, &error));
    });
    assert_event(
        &output,
        tracing::Level::ERROR,
        "Non-retryable error processing inbox sync message. The message will be deleted.",
        "handle_non_retryable_error",
        [
            ("error", error.to_string()),
            ("payload", format!("{:?}", data.operation)),
        ],
    );
}

#[tokio::test]
async fn a_missing_upsert_keeps_its_debug_event_and_provider_identity() {
    let (service, _) = make_service(false);
    let output = Output::default();
    service
        .process(Ok(input(InboxSyncOperation::UpsertMessage(
            UpsertMessagePayload {
                provider_message_id: "message-1".into(),
            },
        ))))
        .with_subscriber(output.subscriber())
        .await;
    assert_event(
        &output,
        tracing::Level::DEBUG,
        "Message not found in gmail when attempting to upsert",
        "upsert_message",
        [
            ("provider_message_id", "message-1".into()),
            ("link_id", LINK.to_string()),
        ],
    );
}

#[tokio::test]
async fn catalog_debug_counts_cover_add_update_delete_mixed_and_unchanged() {
    let kept: models_email::service::label::Label = label("kept").into();
    let mut updated = kept.clone();
    updated.name = Some("Updated".into());
    let first: models_email::service::label::Label = label("new-first").into();
    let second: models_email::service::label::Label = label("new-second").into();
    let removed: models_email::service::label::Label = label("removed").into();
    for (case, stored, provider, counts) in [
        ("add", vec![], vec![first.clone(), second], Some((2, 0, 0))),
        (
            "update",
            vec![kept.clone()],
            vec![updated.clone()],
            Some((0, 1, 0)),
        ),
        (
            "delete",
            vec![kept.clone(), removed.clone()],
            vec![],
            Some((0, 0, 2)),
        ),
        (
            "mixed",
            vec![kept.clone(), removed],
            vec![updated, first],
            Some((1, 1, 1)),
        ),
        ("unchanged", vec![kept.clone()], vec![kept], None),
    ] {
        let (_, fake) = make_service(false);
        fake.0.lock().unwrap().import.catalog = stored;
        let output = Output::default();
        super::super::catalog::sync_labels(&fake, LINK, &provider)
            .with_subscriber(output.subscriber())
            .await
            .unwrap();
        if let Some((added, updated, deleted)) = counts {
            assert_event(
                &output,
                tracing::Level::DEBUG,
                "Label synchronization complete",
                "sync_labels",
                [
                    ("link_id", LINK.to_string()),
                    ("added", added.to_string()),
                    ("updated", updated.to_string()),
                    ("deleted", deleted.to_string()),
                ],
            );
        } else {
            assert!(
                !output
                    .0
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|event| event.message == "Label synchronization complete"),
                "{case}"
            );
        }
    }
}

#[tokio::test]
async fn own_sender_filter_keeps_its_debug_event_and_thread_identity() {
    let (mut service, fake) = make_service(false);
    service.features.notifications_enabled = true;
    {
        let mut state = fake.0.lock().unwrap();
        state.message = None;
        state.import.fetched = Ok(Some(
            email_api_client::domain::models::MessageWithCalendarParts {
                message: super::import_fakes::received_message(LINK, THREAD),
                calendar_parts: vec![],
            },
        ));
        let sender = Uuid::from_u128(9);
        state.import.committed.as_mut().unwrap().from_contact_id = Some(sender);
        state.import.senders.insert(
            sender,
            models_email::service::address::ContactInfo {
                email: format!("no-reply@{}", email_utils::MACRO_NOTIFICATION_SENDER_DOMAIN),
                name: None,
                photo_url: None,
            },
        );
    }
    let output = Output::default();
    service
        .process(Ok(input(InboxSyncOperation::UpsertMessage(
            UpsertMessagePayload {
                provider_message_id: "message-1".into(),
            },
        ))))
        .with_subscriber(output.subscriber())
        .await;
    assert_event(
        &output,
        tracing::Level::DEBUG,
        "skipping new-email notification for Macro's own notification sender",
        "send_notifications",
        [("thread_id", THREAD.to_string())],
    );
}
