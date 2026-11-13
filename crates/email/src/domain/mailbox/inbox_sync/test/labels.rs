use super::fakes::{Call, LINK, THREAD, input, label, make_service};
use super::*;
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};

fn operation() -> InboxSyncOperation {
    InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
        provider_message_id: "message-1".into(),
    })
}

fn events(calls: &[Call]) -> Vec<&serde_json::Value> {
    calls
        .iter()
        .filter_map(|call| match call {
            Call::Event(event) => Some(event),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_missing_database_message_queues_the_exact_upsert_and_is_terminal() {
    for queue_fails in [false, true] {
        let (service, fake) = make_service(true);
        fake.0.lock().unwrap().message = None;
        if queue_fails {
            fake.0.lock().unwrap().failures.push(("enqueue", 1));
        }
        let (delete, error) = failure(service.process(Ok(input(operation()))).await);
        assert!(delete);
        assert_eq!(
            error.reason,
            if queue_fails {
                FailureReason::SqsEnqueueFailed
            } else {
                FailureReason::MessageNotFoundInDatabase
            }
        );
        assert!(error.source.to_string().starts_with("remove_labels: "));
        assert_eq!(
            fake.calls(),
            vec![
                Call::Link,
                Call::Message,
                Call::Enqueue(
                    false,
                    serde_json::to_value(input(InboxSyncOperation::UpsertMessage(
                        UpsertMessagePayload {
                            provider_message_id: "message-1".into()
                        }
                    )))
                    .unwrap()
                )
            ]
        );
    }
}

#[tokio::test]
async fn the_provider_read_stays_between_pending_reads_even_when_it_fails_or_returns_none() {
    for value in [Ok(None), Err(EmailApiError::Forbidden)] {
        let (service, fake) = make_service(false);
        fake.0.lock().unwrap().provider = value.clone();
        let result = service.process(Ok(input(operation()))).await;
        assert_eq!(
            fake.calls(),
            vec![
                Call::Link,
                Call::Message,
                Call::Labels,
                Call::Pending,
                Call::Provider,
                Call::Pending
            ]
        );
        match value {
            Ok(None) => assert!(matches!(result, InboxSyncDisposition::DoneDelete)),
            Err(_) => assert!(failure(result).0),
            _ => unreachable!(),
        }
    }
}

#[tokio::test]
async fn each_provider_error_preserves_primary_retry_routing_and_reason() {
    let errors = vec![
        (
            EmailApiError::RateLimited {
                retry_after: None,
                origin: RateLimitOrigin::Local,
            },
            true,
            FailureReason::GmailApiRateLimited,
        ),
        (
            EmailApiError::RateLimited {
                retry_after: None,
                origin: RateLimitOrigin::Provider { concurrency: false },
            },
            true,
            FailureReason::GmailApiRateLimited,
        ),
        (
            EmailApiError::RateLimited {
                retry_after: None,
                origin: RateLimitOrigin::Provider { concurrency: true },
            },
            true,
            FailureReason::GmailApiRateLimited,
        ),
        (
            EmailApiError::Transient {
                message: "unavailable".into(),
            },
            true,
            FailureReason::GmailApiUnavailable,
        ),
        (
            EmailApiError::CredentialsUnavailable {
                message: "credentials".into(),
            },
            true,
            FailureReason::GmailApiUnavailable,
        ),
        (
            EmailApiError::AuthRequired,
            false,
            FailureReason::AccessTokenFetchFailed,
        ),
        (
            EmailApiError::OutdatedCursor,
            false,
            FailureReason::OutdatedHistoryId,
        ),
        (
            EmailApiError::Forbidden,
            false,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::NotFound,
            false,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::Conflict,
            false,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::SendRejected {
                message: "rejected".into(),
            },
            false,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::Permanent {
                message: "permanent".into(),
            },
            false,
            FailureReason::GmailApiFailed,
        ),
    ];
    for retry in [false, true] {
        for (provider_error, rate_limited, reason) in &errors {
            let (service, fake) = make_service(retry);
            fake.0.lock().unwrap().provider = Err(provider_error.clone());
            let (delete, error) = failure(service.process(Ok(input(operation()))).await);
            assert_eq!(
                delete,
                if *rate_limited {
                    !retry
                } else {
                    !matches!(
                        provider_error,
                        EmailApiError::Transient { .. }
                            | EmailApiError::CredentialsUnavailable { .. }
                    )
                }
            );
            assert_eq!(error.reason, *reason);
            assert_eq!(
                error.source.to_string(),
                format!("remove_labels: {provider_error}")
            );
            let queued = fake
                .calls()
                .into_iter()
                .filter(|call| matches!(call, Call::Enqueue(..)))
                .collect::<Vec<_>>();
            assert_eq!(
                queued,
                if *rate_limited && !retry {
                    vec![Call::Enqueue(
                        true,
                        serde_json::to_value(input(operation())).unwrap(),
                    )]
                } else {
                    vec![]
                }
            );
        }
    }
}

#[tokio::test]
async fn failed_retry_publication_and_pending_after_failure_override_the_provider_error() {
    for stage in ["enqueue_retry", "pending"] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.provider = Err(EmailApiError::RateLimited {
                retry_after: None,
                origin: RateLimitOrigin::Local,
            });
            state
                .failures
                .push((stage, if stage == "pending" { 2 } else { 1 }));
        }
        let (delete, error) = failure(service.process(Ok(input(operation()))).await);
        assert!(!delete);
        assert_eq!(
            error.reason,
            if stage == "pending" {
                FailureReason::DatabaseQueryFailed
            } else {
                FailureReason::SqsEnqueueFailed
            }
        );
        assert_eq!(
            fake.calls()
                .iter()
                .any(|call| matches!(call, Call::Enqueue(..))),
            stage != "pending"
        );
    }
}

#[tokio::test]
async fn pending_labels_from_either_side_and_unchanged_labels_do_not_publish_or_refresh() {
    for pending in [false, true] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.labels = vec![label("INBOX"), label("LOCAL")];
            if pending {
                state.provider = Ok(Some(vec!["INBOX".into(), "NEW".into()]));
                state
                    .pending
                    .extend([vec!["LOCAL".into()], vec!["NEW".into(), "LOCAL".into()]]);
            } else {
                state.provider = Ok(Some(vec!["INBOX".into(), "LOCAL".into()]));
            }
        }
        assert!(matches!(
            service.process(Ok(input(operation()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        assert_eq!(
            fake.calls(),
            vec![
                Call::Link,
                Call::Message,
                Call::Labels,
                Call::Pending,
                Call::Provider,
                Call::Pending
            ]
        );
    }
}

#[tokio::test]
async fn additions_commit_before_removals_and_events_preserve_fixed_order_and_label_identity() {
    let (service, fake) = make_service(false);
    {
        let mut state = fake.0.lock().unwrap();
        state.labels = vec![label("INBOX"), label("Label_old")];
        state.provider = Ok(Some(
            ["TRASH", "SPAM", "UNREAD", "STARRED", "Label_new"]
                .map(str::to_owned)
                .to_vec(),
        ));
    }
    assert!(matches!(
        service.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let calls = fake.calls();
    assert_eq!(
        &calls[6..16],
        &[
            Call::Begin("labels"),
            Call::Add(
                ["TRASH", "SPAM", "UNREAD", "STARRED", "Label_new"]
                    .map(str::to_owned)
                    .to_vec()
            ),
            Call::SetRead(false),
            Call::SetStarred(true),
            Call::ThreadUpdate,
            Call::Commit,
            Call::Begin("labels"),
            Call::Remove(vec!["INBOX".into(), "Label_old".into()]),
            Call::ThreadUpdate,
            Call::Commit,
        ]
    );
    let events = events(&calls);
    assert_eq!(
        events
            .iter()
            .map(|event| event["event_type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "email.thread_archived",
            "email.thread_trashed",
            "email.thread_spam_changed",
            "email.thread_read",
            "email.thread_starred",
            "email.thread_labels_updated"
        ]
    );
    assert_eq!(events[0]["metadata"]["archived"], true);
    assert_eq!(events[3]["metadata"]["is_read"], false);
    assert_eq!(
        events[5]["metadata"]["added"][0]["provider_label_id"],
        "Label_new"
    );
    assert!(events[5]["metadata"]["added"][0]["label_id"].is_null());
    assert_eq!(events[5]["metadata"]["removed"][0]["name"], "Label_old");
    assert!(
        events
            .iter()
            .all(|event| event["metadata"]["origin"] == "provider_sync"
                && event["metadata"]["actor"].is_null())
    );
    assert_eq!(calls.last(), Some(&Call::Refresh(false)));
}

#[tokio::test]
async fn removals_mark_read_and_provider_system_labels_only_refresh_without_user_events() {
    for read in [false, true] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.labels = vec![label(if read { "UNREAD" } else { "IMPORTANT" })];
            state.provider = Ok(Some(if read {
                vec![]
            } else {
                ["SENT", "DRAFT", "CATEGORY_PERSONAL"]
                    .map(str::to_owned)
                    .to_vec()
            }));
        }
        assert!(matches!(
            service.process(Ok(input(operation()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        let calls = fake.calls();
        assert_eq!(calls.contains(&Call::SetRead(true)), read);
        assert_eq!(events(&calls).len(), usize::from(read));
        assert_eq!(calls.last(), Some(&Call::Refresh(false)));
    }
}

#[tokio::test]
async fn each_read_and_transaction_failure_keeps_delivery_and_prevents_later_effects() {
    for (stage, nth) in [
        ("message", 1),
        ("labels", 1),
        ("pending", 1),
        ("pending", 2),
        ("begin_labels", 1),
        ("add", 1),
        ("set_read", 1),
        ("update_thread", 1),
        ("commit", 1),
        ("begin_labels", 2),
        ("remove", 1),
        ("set_read", 2),
        ("update_thread", 2),
        ("commit", 2),
    ] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.labels = vec![label("INBOX"), label("UNREAD")];
            // Add STARRED before removing INBOX; read-state cases select their half explicitly.
            state.provider = Ok(Some(vec!["UNREAD".into(), "STARRED".into()]));
            if stage == "set_read" && nth == 2 {
                // The normal diff cannot both add and remove UNREAD; test removal's first call instead.
                state.provider = Ok(Some(vec!["STARRED".into()]));
            }
            state
                .failures
                .push((stage, if stage == "set_read" { 1 } else { nth }));
            if stage == "set_read" && nth == 1 {
                state.labels = vec![label("INBOX")];
            }
        }
        let (delete, error) = failure(service.process(Ok(input(operation()))).await);
        assert!(!delete, "{stage} {nth}");
        assert_eq!(
            error.reason,
            FailureReason::DatabaseQueryFailed,
            "{stage} {nth}"
        );
        assert!(
            !fake
                .calls()
                .iter()
                .any(|call| matches!(call, Call::Event(_) | Call::Refresh(_))),
            "{stage} {nth}"
        );
    }
}

#[tokio::test]
async fn thread_state_overrides_message_flags_and_failed_lookup_uses_label_fallback() {
    for missing in [false, true] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.labels = vec![label("INBOX"), label("UNREAD")];
            state.provider = Ok(Some(vec![]));
            if missing {
                state.failures.push(("thread", 1));
            } else {
                state.thread = Some(models_email::service::thread::Thread {
                    db_id: THREAD,
                    provider_id: None,
                    link_id: LINK,
                    inbox_visible: true,
                    is_read: false,
                    latest_inbound_message_ts: None,
                    latest_outbound_message_ts: None,
                    latest_non_spam_message_ts: None,
                    created_at: Default::default(),
                    updated_at: Default::default(),
                    messages: vec![],
                });
            }
        }
        assert!(matches!(
            service.process(Ok(input(operation()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        let calls = fake.calls();
        let events = events(&calls);
        assert_eq!(events[0]["metadata"]["archived"], missing);
        assert_eq!(events[1]["metadata"]["is_read"], missing);
        assert_eq!(calls.last(), Some(&Call::Refresh(false)));
    }
}

#[tokio::test]
async fn broker_errors_are_best_effort_and_a_resynced_duplicate_has_no_new_effects() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().failures.push(("event", 1));
    assert!(matches!(
        service.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert_eq!(fake.calls().last(), Some(&Call::Refresh(false)));
    {
        let mut state = fake.0.lock().unwrap();
        state.labels = vec![label("INBOX"), label("UNREAD")];
        state.calls.clear();
    }
    assert!(matches!(
        service.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert!(
        !fake
            .calls()
            .iter()
            .any(|call| matches!(call, Call::Event(_) | Call::Refresh(_)))
    );
}

#[tokio::test]
async fn reverse_provider_changes_publish_false_flags_and_the_removed_user_label() {
    let (service, fake) = make_service(false);
    {
        let mut state = fake.0.lock().unwrap();
        state.labels = ["TRASH", "SPAM", "UNREAD", "STARRED", "Label_old"]
            .into_iter()
            .map(label)
            .collect();
        state.provider = Ok(Some(vec!["INBOX".into()]));
    }
    assert!(matches!(
        service.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let calls = fake.calls();
    assert!(calls.contains(&Call::Add(vec!["INBOX".into()])));
    assert!(calls.contains(&Call::SetRead(true)));
    assert!(calls.contains(&Call::SetStarred(false)));
    let events = events(&calls);
    assert_eq!(events.len(), 6);
    assert_eq!(events[0]["metadata"]["archived"], false);
    assert_eq!(events[1]["metadata"]["trashed"], false);
    assert_eq!(events[2]["metadata"]["spam"], false);
    assert_eq!(events[3]["metadata"]["is_read"], true);
    assert_eq!(events[4]["metadata"]["starred"], false);
    assert_eq!(
        events[5]["metadata"]["removed"][0]["provider_label_id"],
        "Label_old"
    );
    assert_eq!(events[5]["metadata"]["added"], serde_json::json!([]));
}

#[tokio::test]
async fn a_star_set_or_removed_in_gmail_sets_the_starred_flag_the_inbox_shows() {
    for starred in [true, false] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.labels = if starred {
                vec![label("INBOX")]
            } else {
                vec![label("INBOX"), label("STARRED")]
            };
            state.provider = Ok(Some(if starred {
                vec!["INBOX".into(), "STARRED".into()]
            } else {
                vec!["INBOX".into()]
            }));
        }
        assert!(matches!(
            service.process(Ok(input(operation()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        let calls = fake.calls();
        assert!(calls.contains(&Call::SetStarred(starred)), "{calls:?}");
        assert!(!calls.contains(&Call::SetStarred(!starred)), "{calls:?}");
    }
}
