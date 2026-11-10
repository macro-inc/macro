use super::fakes::{Call, contact, input, make_service};
use super::*;

fn operation() -> InboxSyncOperation {
    InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
        provider_message_id: "message-1".into(),
    })
}

#[tokio::test]
async fn deletion_reads_only_the_addresses_for_the_messages_direction() {
    for (sent, draft, addresses) in [
        (false, false, vec!["sender@example.com"]),
        (true, false, vec!["recipient@example.com"]),
        (true, true, vec![]),
    ] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            let message = state.message.as_mut().unwrap();
            message.is_sent = sent;
            message.is_draft = draft;
        }
        assert!(matches!(
            service.process(Ok(input(operation())), &fake).await,
            InboxSyncDisposition::DoneDelete
        ));
        let calls = fake.calls();
        assert_eq!(calls.contains(&Call::Recipients), sent && !draft);
        assert_eq!(calls.contains(&Call::Sender), !sent && !draft);
        let cleanup: Vec<_> = calls
            .iter()
            .filter_map(|call| match call {
                Call::Cleanup(emails) => Some(emails.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            cleanup,
            if addresses.is_empty() {
                vec![]
            } else {
                vec![
                    addresses
                        .iter()
                        .map(|email| email.to_string())
                        .collect::<Vec<_>>(),
                ]
            }
        );
        let commit = calls.iter().position(|call| *call == Call::Commit).unwrap();
        let event = calls
            .iter()
            .position(|call| matches!(call, Call::Event(_)))
            .unwrap();
        assert!(commit < event);
        assert_eq!(calls.last(), Some(&Call::Refresh(true)));
    }
}

#[tokio::test]
async fn missing_sender_or_null_recipient_skips_cleanup_but_blank_addresses_keep_the_empty_call() {
    for (sent, address, cleanup_called) in [
        (false, None, false),
        (true, None, false),
        (false, Some(""), true),
        (true, Some(""), true),
    ] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.message.as_mut().unwrap().is_sent = sent;
            state.sender = address.map(|email| contact(Some(email)));
            state.recipients = vec![(
                contact(address),
                models_email::db::address::EmailRecipientType::To,
            )];
        }
        assert!(matches!(
            service.process(Ok(input(operation())), &fake).await,
            InboxSyncDisposition::DoneDelete
        ));
        let cleanup: Vec<_> = fake
            .calls()
            .into_iter()
            .filter_map(|call| match call {
                Call::Cleanup(emails) => Some(emails),
                _ => None,
            })
            .collect();
        assert_eq!(
            cleanup,
            if cleanup_called {
                vec![Vec::<String>::new()]
            } else {
                vec![]
            }
        );
    }
}

#[tokio::test]
async fn cleanup_selection_normalizes_filters_and_preserves_first_seen_order() {
    let (service, fake) = make_service(false);
    {
        let mut state = fake.0.lock().unwrap();
        state.message.as_mut().unwrap().is_sent = true;
        state.link.as_mut().unwrap().email_address =
            EmailStr::try_from("OWNER@EXAMPLE.COM".to_string()).unwrap();
        state.recipients = [
            "\tLater@Example.com \n",
            "malformed",
            "@example.com",
            "missing@",
            "two@@example.com",
            " Owner@Example.com ",
            " FIRST@EXAMPLE.COM ",
            "later@example.com",
            "first@example.com",
            "local@localhost",
        ]
        .into_iter()
        .map(|email| {
            (
                contact(Some(email)),
                models_email::db::address::EmailRecipientType::To,
            )
        })
        .collect();
    }
    assert!(matches!(
        service.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert_eq!(
        &fake.calls()[..7],
        &[
            Call::Link,
            Call::Begin("delete"),
            Call::LockedMessage,
            Call::Recipients,
            Call::Delete,
            Call::Cleanup(vec![
                "later@example.com".into(),
                "first@example.com".into(),
                "local@localhost".into(),
            ]),
            Call::Commit,
        ]
    );
}

#[tokio::test]
async fn missing_message_exits_after_the_locked_lookup_without_committing_or_publishing() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().message = None;
    assert!(matches!(
        service.process(Ok(input(operation())), &fake).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert_eq!(
        fake.calls(),
        vec![Call::Link, Call::Begin("delete"), Call::LockedMessage]
    );
}

#[tokio::test]
async fn deferred_and_already_deleted_results_commit_cleanup_without_events_or_refresh() {
    for deletion in [MessageDeletion::Deferred, MessageDeletion::AlreadyDeleted] {
        let (service, fake) = make_service(false);
        fake.0.lock().unwrap().deletion = deletion;
        assert!(matches!(
            service.process(Ok(input(operation())), &fake).await,
            InboxSyncDisposition::DoneDelete
        ));
        assert_eq!(
            fake.calls(),
            vec![
                Call::Link,
                Call::Begin("delete"),
                Call::LockedMessage,
                Call::Sender,
                Call::Delete,
                Call::Cleanup(vec!["sender@example.com".into()]),
                Call::Commit
            ]
        );
    }
}

#[tokio::test]
async fn every_deletion_failure_remains_retryable_and_stops_later_effects() {
    for (stage, sent, completed_body) in [
        ("begin_delete", false, false),
        ("locked_message", false, false),
        ("sender", false, false),
        ("recipients", true, false),
        ("delete", false, true),
        ("cleanup", false, true),
        ("commit", false, true),
    ] {
        let (service, fake) = make_service(false);
        {
            let mut state = fake.0.lock().unwrap();
            state.message.as_mut().unwrap().is_sent = sent;
            state.failures.push((stage, 1));
        }
        let (delete, error) = failure(service.process(Ok(input(operation())), &fake).await);
        assert!(!delete, "{stage}");
        assert_eq!(error.reason, FailureReason::DatabaseQueryFailed, "{stage}");
        assert!(
            error.source.to_string().starts_with("delete_message: "),
            "{stage}"
        );
        let calls = fake.calls();
        assert_eq!(
            calls.contains(&Call::Rollback),
            completed_body && stage != "commit",
            "{stage}"
        );
        assert!(
            !calls
                .iter()
                .any(|call| matches!(call, Call::Event(_) | Call::Refresh(_))),
            "{stage}"
        );
    }
}

#[tokio::test]
async fn a_failed_rollback_is_propagated_and_broker_rejection_does_not_fail_the_committed_delete() {
    let (service, fake) = make_service(false);
    fake.0
        .lock()
        .unwrap()
        .failures
        .extend([("delete", 1), ("rollback", 1)]);
    let (delete, error) = failure(service.process(Ok(input(operation())), &fake).await);
    assert!(!delete);
    assert_eq!(error.source.to_string(), "delete_message: rollback");
    assert_eq!(fake.calls().last(), Some(&Call::Rollback));
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().failures.push(("event", 1));
    assert!(matches!(
        service.process(Ok(input(operation())), &fake).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert_eq!(fake.calls().last(), Some(&Call::Refresh(true)));
}

#[tokio::test]
async fn a_sender_without_an_address_does_not_enqueue_cleanup() {
    let (service, fake) = make_service(false);
    fake.0.lock().unwrap().sender = Some(contact(None));
    assert!(matches!(
        service.process(Ok(input(operation())), &fake).await,
        InboxSyncDisposition::DoneDelete
    ));
    let calls = fake.calls();
    assert!(calls.contains(&Call::Sender));
    assert!(!calls.iter().any(|call| matches!(call, Call::Cleanup(_))));
    assert_eq!(calls.last(), Some(&Call::Refresh(true)));
}
