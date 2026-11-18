use super::*;
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use models_email::gmail::gmail_ops::{
    BlockSenderPayload, DeleteLabelPayload, GmailMessageRef, ModifyMessageLabelsBatchPayload,
    ModifyMessageLabelsPayload, UnblockSenderPayload,
};
use uuid::Uuid;

mod events;
mod fixtures;
use fixtures::*;

fn detail(outcome: GmailOpsDisposition) -> (bool, DetailedError) {
    match outcome {
        GmailOpsDisposition::FailureDelete { error, .. } => (true, error),
        GmailOpsDisposition::LeaveForRedelivery { error, .. } => (false, error),
        _ => panic!("expected classified failure"),
    }
}

fn permanent() -> EmailApiError {
    EmailApiError::Permanent {
        message: "rejected".into(),
    }
}

fn provider_calls(fake: &Fake) -> Vec<Call> {
    fake.calls()
        .into_iter()
        .filter(|call| {
            matches!(
                call,
                Call::One(..)
                    | Call::Batch(..)
                    | Call::Delete(..)
                    | Call::Block(..)
                    | Call::Unblock(..)
            )
        })
        .collect()
}

#[tokio::test]
async fn malformed_body_is_deleted_best_effort_and_returns_the_original_error() {
    let (service, fake) = make_service(false);
    let original = anyhow!("malformed body").context("decode failed");
    let GmailOpsDisposition::InvalidDelete(error) = service.process(Err(original)).await else {
        panic!("malformed delivery disposition");
    };
    assert_eq!(format!("{error:#}"), "decode failed: malformed body");
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn missing_link_is_terminal_but_a_link_query_failure_is_redelivered() {
    for (missing, fault, deleted, reason) in [
        (true, None, true, FailureReason::LinkNotFound),
        (
            false,
            Some("link"),
            false,
            FailureReason::DatabaseQueryFailed,
        ),
    ] {
        let (service, fake) = make_service(false);
        fake.0.lock().unwrap().missing_link = missing;
        fake.0.lock().unwrap().fault = fault;
        let (actual_deleted, error) = detail(service.process(Ok(message(1, true))).await);
        assert_eq!((actual_deleted, error.reason), (deleted, reason));
        assert_eq!(fake.calls(), vec![Call::Link]);
    }
}

#[tokio::test]
async fn each_operation_dispatches_to_its_provider_capability() {
    let mut single = message(1, true);
    single.operation = GmailOpsOperation::ModifyMessageLabels(ModifyMessageLabelsPayload {
        db_message_id: Uuid::from_u128(1),
        provider_message_id: "m1".into(),
        labels_to_add: vec!["Label_work".into()],
        labels_to_remove: vec![],
        pending_write_id: Some(WRITE),
    });
    let cases = [
        (
            single,
            Call::One("m1".into(), vec!["Label_work".into()], vec![], false),
        ),
        (
            GmailOpsPubsubMessage {
                link_id: LINK,
                operation: GmailOpsOperation::DeleteLabel(DeleteLabelPayload {
                    provider_label_id: "label".into(),
                }),
            },
            Call::Delete("label".into()),
        ),
        (
            GmailOpsPubsubMessage {
                link_id: LINK,
                operation: GmailOpsOperation::BlockSender(BlockSenderPayload {
                    email_address: "sender@example.com".into(),
                }),
            },
            Call::Block("sender@example.com".into()),
        ),
        (
            GmailOpsPubsubMessage {
                link_id: LINK,
                operation: GmailOpsOperation::UnblockSender(UnblockSenderPayload {
                    email_address: "sender@example.com".into(),
                }),
            },
            Call::Unblock("sender@example.com".into()),
        ),
    ];
    for (message, expected) in cases {
        let (service, fake) = make_service(false);
        assert!(matches!(
            service.process(Ok(message)).await,
            GmailOpsDisposition::DoneDelete
        ));
        assert_eq!(provider_calls(&fake), vec![expected]);
    }
}

#[tokio::test]
async fn provider_errors_keep_the_queue_route_and_original_reason_for_every_variant() {
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
                message: "token".into(),
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
            EmailApiError::OutdatedCursor,
            false,
            FailureReason::OutdatedHistoryId,
        ),
        (
            EmailApiError::SendRejected {
                message: "send".into(),
            },
            false,
            FailureReason::GmailApiFailed,
        ),
        (permanent(), false, FailureReason::GmailApiFailed),
    ];
    for retry in [false, true] {
        for (error, deferred, reason) in &errors {
            let (service, fake) = make_service(retry);
            fake.0.lock().unwrap().replies.push_back(Err(error.clone()));
            let message = GmailOpsPubsubMessage {
                link_id: LINK,
                operation: GmailOpsOperation::BlockSender(BlockSenderPayload {
                    email_address: "sender@example.com".into(),
                }),
            };
            let encoded = serde_json::to_string(&message).unwrap();
            let (deleted, detail) = detail(service.process(Ok(message)).await);
            assert_eq!(deleted, !retry || !deferred);
            assert_eq!(detail.reason, *reason);
            assert_eq!(detail.source.to_string(), format!("block_sender: {error}"));
            let queued: Vec<_> = fake
                .calls()
                .into_iter()
                .filter(|call| matches!(call, Call::Retry(_)))
                .collect();
            assert_eq!(
                queued,
                if *deferred && !retry {
                    vec![Call::Retry(encoded)]
                } else {
                    vec![]
                }
            );
        }
    }
}

#[tokio::test]
async fn missing_label_delete_is_success_and_other_provider_failures_are_not() {
    for (error, succeeds) in [
        (EmailApiError::NotFound, true),
        (EmailApiError::Forbidden, false),
    ] {
        let (service, fake) = make_service(false);
        fake.0.lock().unwrap().replies.push_back(Err(error));
        let message = GmailOpsPubsubMessage {
            link_id: LINK,
            operation: GmailOpsOperation::DeleteLabel(DeleteLabelPayload {
                provider_label_id: "label".into(),
            }),
        };
        let result = service.process(Ok(message)).await;
        assert_eq!(matches!(result, GmailOpsDisposition::DoneDelete), succeeds);
        assert_eq!(provider_calls(&fake), vec![Call::Delete("label".into())]);
    }
}

#[tokio::test]
async fn failed_retry_publication_keeps_the_primary_message_for_redelivery() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().fault = Some("enqueue");
    fake.0
        .lock()
        .unwrap()
        .replies
        .push_back(Err(EmailApiError::Transient {
            message: "offline".into(),
        }));
    let (deleted, error) = detail(service.process(Ok(message(1, true))).await);
    assert!(!deleted);
    assert_eq!(error.reason, FailureReason::SqsEnqueueFailed);
    assert_eq!(
        error.source.to_string(),
        "modify_message_labels: Failed to enqueue gmail ops retry message"
    );
    assert!(
        !fake
            .calls()
            .iter()
            .any(|call| matches!(call, Call::Revert(..)))
    );
}

#[tokio::test]
async fn newest_writes_settle_per_message_below_ten_and_as_one_batch_from_ten() {
    for count in [1, 2, 9, 10, 1000] {
        let (service, fake) = make_service(false);
        assert!(matches!(
            service.process(Ok(message(count, true))).await,
            GmailOpsDisposition::DoneDelete
        ));
        let calls = fake.calls();
        let confirms: Vec<_> = calls
            .iter()
            .filter(|call| matches!(call, Call::Confirm(..)))
            .collect();
        if count < 10 {
            assert_eq!(provider_calls(&fake).len(), count);
            assert_eq!(confirms.len(), count);
            for call in provider_calls(&fake) {
                let Call::One(_, add, remove, skip_missing) = call else {
                    panic!("separate calls");
                };
                assert_eq!(add, ["Label_work"]);
                assert!(remove.is_empty());
                assert_eq!(skip_missing, count > 1);
            }
        } else {
            assert_eq!(provider_calls(&fake).len(), 1);
            assert_eq!(confirms.len(), 1);
            assert!(
                matches!(&provider_calls(&fake)[0], Call::Batch(messages, _, _) if messages.len() == count)
            );
        }
    }
}

#[tokio::test]
async fn a_duplicate_of_a_confirmed_write_never_calls_gmail_again() {
    let (service, fake) = make_service(false);
    let message = message(2, true);
    assert!(matches!(
        service.process(Ok(message.clone())).await,
        GmailOpsDisposition::DoneDelete
    ));
    fake.0.lock().unwrap().calls.clear();
    assert!(matches!(
        service.process(Ok(message)).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert!(provider_calls(&fake).is_empty());
    assert!(fake.calls().contains(&Call::Abandon(ids(&[1, 2]), WRITE)));
}

#[tokio::test]
async fn sendable_messages_finish_before_a_waiting_message_is_deferred() {
    for retry in [false, true] {
        let (service, fake) = make_service(retry);
        fake.0.lock().unwrap().turns.push_back(turns(&[
            (1, LabelWriteTurn::Send),
            (2, LabelWriteTurn::Wait),
            (3, LabelWriteTurn::Superseded),
        ]));
        let input = message(3, true);
        let (deleted, error) = detail(service.process(Ok(input.clone())).await);
        assert_eq!(deleted, !retry);
        assert_eq!(error.reason, FailureReason::NewerLabelWritePending);
        assert!(fake.calls().contains(&Call::Abandon(ids(&[3]), WRITE)));
        assert!(fake.calls().contains(&Call::Confirm(ids(&[1]), WRITE)));
        assert_eq!(provider_calls(&fake).len(), 1);
        // Once the newer write is rejected, only the waiting message remains sendable.
        fake.0.lock().unwrap().calls.clear();
        assert!(matches!(
            service.process(Ok(input)).await,
            GmailOpsDisposition::DoneDelete
        ));
        assert_eq!(
            provider_calls(&fake),
            vec![Call::One(
                "m2".into(),
                vec!["Label_work".into()],
                vec![],
                true
            )]
        );
    }
}

#[tokio::test]
async fn waiting_enqueue_failure_is_retryable_and_an_all_superseded_write_finishes() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().fault = Some("enqueue");
    fake.0
        .lock()
        .unwrap()
        .turns
        .push_back(turns(&[(1, LabelWriteTurn::Wait)]));
    let (deleted, error) = detail(service.process(Ok(message(1, true))).await);
    assert!(!deleted);
    assert_eq!(error.reason, FailureReason::SqsEnqueueFailed);
    assert!(provider_calls(&fake).is_empty());

    let (service, fake) = make_service(false);
    fake.0
        .lock()
        .unwrap()
        .turns
        .push_back(turns(&[(1, LabelWriteTurn::Superseded)]));
    assert!(matches!(
        service.process(Ok(message(1, true))).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert_eq!(fake.calls().last(), Some(&Call::Abandon(ids(&[1]), WRITE)));
}

#[tokio::test]
async fn missing_turn_entries_are_abandoned_and_empty_marked_writes_do_not_send() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().turns.push_back(turns(&[]));
    assert!(matches!(
        service.process(Ok(message(2, true))).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert!(fake.calls().contains(&Call::Abandon(ids(&[1, 2]), WRITE)));
    assert!(provider_calls(&fake).is_empty());
    let (service, fake) = make_service(false);
    assert!(matches!(
        service.process(Ok(message(0, true))).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert!(provider_calls(&fake).is_empty());
}

#[tokio::test]
async fn a_mid_send_turn_change_waits_or_abandons_without_sending_the_changed_messages() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().turns.extend([
        turns(&[
            (1, LabelWriteTurn::Send),
            (2, LabelWriteTurn::Send),
            (3, LabelWriteTurn::Send),
        ]),
        turns(&[(2, LabelWriteTurn::Wait)]),
        turns(&[(3, LabelWriteTurn::Superseded)]),
    ]);
    let (_, error) = detail(service.process(Ok(message(3, true))).await);
    assert_eq!(error.reason, FailureReason::NewerLabelWritePending);
    assert_eq!(provider_calls(&fake).len(), 1);
    assert!(fake.calls().contains(&Call::Abandon(ids(&[3]), WRITE)));
}

#[tokio::test]
async fn permanent_partial_failure_reverts_only_unaccepted_and_waiting_messages() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().turns.push_back(turns(&[
        (1, LabelWriteTurn::Send),
        (2, LabelWriteTurn::Send),
        (3, LabelWriteTurn::Send),
        (4, LabelWriteTurn::Wait),
    ]));
    fake.0
        .lock()
        .unwrap()
        .replies
        .extend([Ok(()), Err(permanent())]);
    let input = message(4, true);
    let (deleted, error) = detail(service.process(Ok(input.clone())).await);
    assert!(deleted);
    assert_eq!(error.reason, FailureReason::GmailApiFailed);
    assert!(fake.calls().contains(&Call::Confirm(ids(&[1]), WRITE)));
    assert!(fake.calls().contains(&Call::Revert(
        ids(&[2, 3, 4]),
        LabelWriteRevert::Pending(WRITE)
    )));
    assert_eq!(provider_calls(&fake).len(), 2);
    fake.0.lock().unwrap().calls.clear();
    assert!(matches!(
        service.process(Ok(input)).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert!(provider_calls(&fake).is_empty());
}

#[tokio::test]
async fn transient_partial_failure_keeps_unaccepted_changes_for_retry() {
    let (service, fake) = make_service(true);
    fake.0.lock().unwrap().replies.extend([
        Ok(()),
        Err(EmailApiError::Transient {
            message: "offline".into(),
        }),
    ]);
    let input = message(3, true);
    let (deleted, _) = detail(service.process(Ok(input.clone())).await);
    assert!(!deleted);
    assert!(
        !fake
            .calls()
            .iter()
            .any(|call| matches!(call, Call::Revert(..)))
    );
    fake.0.lock().unwrap().calls.clear();
    assert!(matches!(
        service.process(Ok(input)).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert_eq!(provider_calls(&fake).len(), 2);
    assert!(matches!(&provider_calls(&fake)[0], Call::One(id, _, _, _) if id == "m2"));
}

#[tokio::test]
async fn permanent_batch_failure_reverts_the_whole_batch_and_waiting_messages_in_order() {
    let (service, fake) = make_service(false);
    let initial = (1..=11)
        .map(|id| {
            (
                id,
                if id == 11 {
                    LabelWriteTurn::Wait
                } else {
                    LabelWriteTurn::Send
                },
            )
        })
        .collect::<Vec<_>>();
    fake.0.lock().unwrap().turns.push_back(turns(&initial));
    fake.0.lock().unwrap().replies.push_back(Err(permanent()));
    let (deleted, _) = detail(service.process(Ok(message(11, true))).await);
    assert!(deleted);
    assert_eq!(provider_calls(&fake).len(), 1);
    assert!(fake.calls().contains(&Call::Revert(
        ids(&(1..=11).collect::<Vec<_>>()),
        LabelWriteRevert::Pending(WRITE)
    )));
}

#[tokio::test]
async fn legacy_writes_invert_only_the_first_label_and_its_original_system_flag() {
    for adding in [false, true] {
        for (label, flag) in [
            ("UNREAD", RevertedMessageFlag::Read(adding)),
            ("STARRED", RevertedMessageFlag::Starred(!adding)),
            ("Label_work", RevertedMessageFlag::None),
        ] {
            let (service, fake) = make_service(false);
            fake.0.lock().unwrap().replies.push_back(Err(permanent()));
            let mut input = message(2, false);
            let labels = vec![label.into(), "ignored-second-label".into()];
            if adding {
                payload(&mut input).labels_to_add = labels;
            } else {
                payload(&mut input).labels_to_add.clear();
                payload(&mut input).labels_to_remove = labels;
            }
            let (deleted, _) = detail(service.process(Ok(input)).await);
            assert!(deleted);
            assert!(fake.calls().contains(&Call::Revert(
                ids(&[1, 2]),
                LabelWriteRevert::Legacy {
                    provider_label_id: label.into(),
                    was_adding: adding,
                    flag,
                }
            )));
            assert!(
                !fake
                    .calls()
                    .iter()
                    .any(|call| matches!(call, Call::Turns(..) | Call::Confirm(..)))
            );
        }
    }
}

#[tokio::test]
async fn legacy_empty_labels_select_the_empty_revert_and_unmarked_empty_batch_still_calls_the_port()
{
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().replies.push_back(Err(permanent()));
    let mut input = message(2, false);
    payload(&mut input).labels_to_add.clear();
    let (_, error) = detail(service.process(Ok(input)).await);
    assert_eq!(error.reason, FailureReason::GmailApiFailed);
    assert!(
        fake.calls()
            .contains(&Call::Revert(ids(&[1, 2]), LabelWriteRevert::NoLabel))
    );
    let (service, fake) = make_service(false);
    assert!(matches!(
        service.process(Ok(message(0, false))).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert_eq!(
        provider_calls(&fake),
        vec![Call::Batch(vec![], vec!["Label_work".into()], vec![])]
    );
}

#[tokio::test]
async fn every_persistence_failure_keeps_the_message_and_never_queues_a_retry() {
    for fault in ["turns", "abandon", "confirm", "revert"] {
        let (service, fake) = make_service(false);
        fake.0.lock().unwrap().fault = Some(fault);
        if fault == "abandon" {
            fake.0
                .lock()
                .unwrap()
                .turns
                .push_back(turns(&[(1, LabelWriteTurn::Superseded)]));
        }
        if fault == "revert" {
            fake.0.lock().unwrap().replies.push_back(Err(permanent()));
        }
        let (deleted, error) = detail(service.process(Ok(message(1, true))).await);
        assert!(!deleted, "{fault}");
        assert_eq!(error.reason, FailureReason::DatabaseQueryFailed, "{fault}");
        assert!(
            error
                .source
                .to_string()
                .starts_with("modify_message_labels: ")
        );
        assert!(
            !fake
                .calls()
                .iter()
                .any(|call| matches!(call, Call::Retry(_)))
        );
    }
}

#[tokio::test]
async fn deferred_and_permanent_deletions_carry_different_domain_log_policies() {
    for deferred in [false, true] {
        let (service, fake) = make_service(false);
        fake.0.lock().unwrap().replies.push_back(Err(if deferred {
            EmailApiError::Transient {
                message: "offline".into(),
            }
        } else {
            permanent()
        }));
        let GmailOpsDisposition::FailureDelete { log, .. } =
            service.process(Ok(message(1, true))).await
        else {
            panic!("primary failure must delete");
        };
        assert_eq!(matches!(log, GmailOpsFailureLog::Deferred), deferred);
        assert_eq!(matches!(log, GmailOpsFailureLog::Permanent), !deferred);
    }
}

#[tokio::test]
async fn batch_and_legacy_transient_failures_keep_the_optimistic_changes() {
    for (count, marked) in [(10, true), (2, false)] {
        let (service, fake) = make_service(true);
        fake.0
            .lock()
            .unwrap()
            .replies
            .push_back(Err(EmailApiError::Transient {
                message: "offline".into(),
            }));
        let (deleted, error) = detail(service.process(Ok(message(count, marked))).await);
        assert!(!deleted);
        assert_eq!(error.reason, FailureReason::GmailApiUnavailable);
        assert!(matches!(
            provider_calls(&fake).as_slice(),
            [Call::Batch(..)]
        ));
        assert!(
            !fake
                .calls()
                .iter()
                .any(|call| matches!(call, Call::Confirm(..) | Call::Revert(..)))
        );
    }
}

#[tokio::test]
async fn provider_labels_keep_add_remove_order_and_duplicate_message_ids_are_rechecked() {
    let (service, fake) = make_service(false);
    let mut input = message(1, true);
    payload(&mut input).labels_to_add = vec!["add".into()];
    payload(&mut input).labels_to_remove = vec!["remove".into(), "add".into()];
    let duplicate = payload(&mut input).messages[0].clone();
    payload(&mut input).messages.push(duplicate);
    assert!(matches!(
        service.process(Ok(input)).await,
        GmailOpsDisposition::DoneDelete
    ));
    assert_eq!(
        fake.calls()[1],
        Call::Turns(
            ids(&[1, 1]),
            vec!["add".into(), "remove".into(), "add".into()],
            WRITE
        )
    );
    assert_eq!(provider_calls(&fake).len(), 1);
    assert!(fake.calls().contains(&Call::Abandon(ids(&[1]), WRITE)));
}
