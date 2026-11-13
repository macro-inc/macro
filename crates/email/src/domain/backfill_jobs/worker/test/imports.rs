use super::*;
use email_api_client::domain::models::{CalendarPart, EmailApiError, MessageWithCalendarParts};
use models_email::service::{address::ContactInfo, message::SimpleMessage};

fn thread(refresh: bool) -> BackfillPubsubMessage {
    input(BackfillOperation::BackfillThread(scope(
        BackfillThreadPayload {
            thread_provider_id: "thread".into(),
            refresh_existing: refresh,
        },
    )))
}
fn message() -> BackfillPubsubMessage {
    input(BackfillOperation::BackfillMessage(scope(
        BackfillMessagePayload {
            thread_provider_id: "thread".into(),
            thread_db_id: Uuid::from_u128(40),
            message_provider_id: "message".into(),
        },
    )))
}
fn part() -> CalendarPart {
    CalendarPart {
        part_id: Some("part".into()),
        filename: None,
        mime_type: "text/calendar".into(),
        inline_data: Some(vec![]),
        provider_attachment_id: None,
    }
}
fn fetched(id: &str, parts: bool) -> MessageWithCalendarParts {
    let mut message = provider_message(LINK, Uuid::from_u128(40));
    message.provider_id = Some(id.into());
    MessageWithCalendarParts {
        message,
        calendar_parts: if parts { vec![part()] } else { vec![] },
    }
}
fn stored() -> SimpleMessage {
    SimpleMessage {
        db_id: Uuid::from_u128(60),
        provider_id: Some("message".into()),
        thread_db_id: Uuid::from_u128(40),
        provider_thread_id: Some("thread".into()),
        replying_to_id: None,
        global_id: "global".into(),
        link_id: LINK,
        subject: None,
        snippet: None,
        from_contact_id: None,
        provider_history_id: None,
        internal_date_ts: None,
        sent_at: None,
        size_estimate: None,
        is_read: true,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        has_attachments: false,
        headers_json: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

#[tokio::test]
async fn new_thread_prepares_all_messages_and_writes_under_a_slot_before_followups() {
    let (svc, f) = setup();
    f.0.lock().unwrap().import.thread = Ok(vec![fetched("one", false), fetched("two", false)]);
    assert!(matches!(
        svc.process(&thread(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "existing_threads",
            "get_thread",
            "prepare",
            "prepare",
            "acquire_write",
            "hold",
            "insert_thread",
            "release",
            "thread_attachments",
            "enqueue_metadata"
        ]
    );
    let s = f.0.lock().unwrap();
    assert_eq!(
        s.import
            .persisted
            .iter()
            .map(|m| m.provider_id.as_deref())
            .collect::<Vec<_>>(),
        [Some("one"), Some("two")]
    );
    assert!(
        s.import
            .persisted
            .iter()
            .all(|m| m.snippet.as_deref() == Some("prepared"))
    );
}

#[tokio::test]
async fn existing_thread_without_refresh_only_advances_completion() {
    let (svc, f) = setup();
    f.0.lock()
        .unwrap()
        .import
        .existing_threads
        .insert("thread".into(), Uuid::from_u128(40));
    assert!(matches!(
        svc.process(&thread(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        ["job", "link", "existing_threads", "completed_thread"]
    );
}

#[tokio::test]
async fn recovery_ignores_existing_and_missing_provider_ids_and_preserves_missing_order() {
    let (svc, f) = setup();
    let mut no_id = fetched("unused", false);
    no_id.message.provider_id = None;
    {
        let mut s = f.0.lock().unwrap();
        s.import
            .existing_threads
            .insert("thread".into(), Uuid::from_u128(40));
        s.import.existing_messages.insert("known".into());
        s.import.thread = Ok(vec![
            fetched("known", false),
            fetched("new-a", false),
            no_id,
            fetched("new-b", false),
        ]);
    }
    assert!(matches!(
        svc.process(&thread(true)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "existing_threads",
            "get_thread",
            "existing_messages",
            "prepare",
            "prepare",
            "acquire_write",
            "hold",
            "insert_messages",
            "release",
            "thread_attachments",
            "enqueue_metadata"
        ]
    );
    assert_eq!(
        f.0.lock()
            .unwrap()
            .import
            .persisted
            .iter()
            .map(|m| m.provider_id.as_deref())
            .collect::<Vec<_>>(),
        [Some("new-a"), Some("new-b")]
    );
}

#[tokio::test]
async fn recovery_with_nothing_missing_counts_without_writing() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.import
            .existing_threads
            .insert("thread".into(), Uuid::from_u128(40));
        s.import.existing_messages.insert("known".into());
        s.import.thread = Ok(vec![fetched("known", false)]);
    }
    assert!(matches!(
        svc.process(&thread(true)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "existing_threads",
            "get_thread",
            "existing_messages",
            "completed_thread"
        ]
    );
}

#[tokio::test]
async fn empty_new_thread_still_writes_and_hands_off_metadata() {
    let (svc, f) = setup();
    assert!(matches!(
        svc.process(&thread(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "existing_threads",
            "get_thread",
            "acquire_write",
            "hold",
            "insert_thread",
            "release",
            "thread_attachments",
            "enqueue_metadata"
        ]
    );
}

#[tokio::test]
async fn thread_lookup_and_writes_preserve_retryable_and_deterministic_errors() {
    for (refresh, fault) in [
        (false, "existing_threads"),
        (true, "existing_messages"),
        (false, "insert_thread"),
        (true, "insert_messages"),
    ] {
        for deterministic in [false, true] {
            let (svc, f) = setup();
            {
                let mut s = f.0.lock().unwrap();
                if refresh {
                    s.import
                        .existing_threads
                        .insert("thread".into(), Uuid::from_u128(40));
                }
                s.import.thread = Ok(vec![fetched("new", false)]);
                if deterministic {
                    s.import.sqlstate = Some("22001".into());
                }
            }
            f.fail(fault);
            failure(
                svc.process(&thread(refresh)).await,
                !deterministic,
                if deterministic {
                    FailureReason::InvalidData
                } else {
                    FailureReason::DatabaseQueryFailed
                },
            );
            assert!(!f.calls().contains(&"enqueue_metadata"));
        }
    }
}

#[tokio::test]
async fn thread_provider_failure_precedes_admission_and_write() {
    let (svc, f) = setup();
    f.0.lock().unwrap().import.thread = Err(EmailApiError::Forbidden);
    failure(
        svc.process(&thread(false)).await,
        false,
        FailureReason::GmailApiFailed,
    );
    assert_eq!(f.calls(), ["job", "link", "existing_threads", "get_thread"]);
}

#[tokio::test]
async fn busy_thread_slot_defers_before_crm_fanout() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.slot = false;
        let mut m = fetched("one", false);
        m.message.is_sent = true;
        m.message.to = vec![ContactInfo {
            email: "contact@example.com".into(),
            name: None,
            photo_url: None,
        }];
        s.import.thread = Ok(vec![m]);
    }
    assert!(matches!(
        svc.process(&thread(false)).await,
        BackfillDisposition::Defer { .. }
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "existing_threads",
            "get_thread",
            "prepare",
            "acquire_write"
        ]
    );
}

#[tokio::test]
async fn thread_crm_fanout_precedes_write_and_its_failure_releases_without_writing() {
    for fail in [false, true] {
        let (svc, f) = setup();
        let mut m = fetched("one", false);
        m.message.is_sent = true;
        m.message.to = vec![ContactInfo {
            email: "contact@example.com".into(),
            name: None,
            photo_url: None,
        }];
        f.0.lock().unwrap().import.thread = Ok(vec![m]);
        if fail {
            f.fail("enqueue");
        }
        let outcome = svc.process(&thread(false)).await;
        if fail {
            failure(outcome, true, FailureReason::SqsEnqueueFailed);
            assert_eq!(f.calls().last(), Some(&"release"));
            assert!(!f.calls().contains(&"insert_thread"));
        } else {
            assert!(matches!(outcome, BackfillDisposition::DoneDelete));
            let c = f.calls();
            assert!(
                c.iter().position(|x| *x == "enqueue").unwrap()
                    < c.iter().position(|x| *x == "insert_thread").unwrap()
            );
        }
    }
}

#[tokio::test]
async fn concurrent_thread_winner_only_counts_the_committed_copy() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.import.thread = Ok(vec![fetched("one", true)]);
        s.import.concurrent = true;
    }
    assert!(matches!(
        svc.process(&thread(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls().last(), Some(&"completed_thread"));
    assert!(!f.calls().contains(&"invitation_id"));
    assert!(!f.calls().contains(&"thread_attachments"));
}

#[tokio::test]
async fn skipped_thread_message_keeps_its_warning_but_skips_only_its_invitation() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.import.thread = Ok(vec![fetched("bad", true), fetched("good", true)]);
        s.import.skipped.push(SkippedBackfillMessage {
            index: 0,
            error: anyhow::anyhow!("cannot store"),
        });
    }
    assert!(matches!(
        svc.process(&thread(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls().iter().filter(|c| **c == "invitation_id").count(),
        1
    );
    assert_eq!(f.calls().iter().filter(|c| **c == "invitations").count(), 1);
    assert_eq!(f.calls().last(), Some(&"enqueue_metadata"));
}

#[tokio::test]
async fn attachment_failure_is_best_effort_while_metadata_handoff_failure_is_terminal() {
    let (svc, f) = setup();
    f.fail("thread_attachments");
    assert!(matches!(
        svc.process(&thread(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls().last(), Some(&"enqueue_metadata"));
    let (svc, f) = setup();
    f.fail("enqueue_metadata");
    failure(
        svc.process(&thread(false)).await,
        false,
        FailureReason::SqsEnqueueFailed,
    );
}

#[tokio::test]
async fn new_single_message_has_no_resync_reads_and_commits_before_its_followups() {
    let (svc, f) = setup();
    f.0.lock().unwrap().provider = Ok(Some(fetched("message", true)));
    assert!(matches!(
        svc.process(&message()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "stored",
            "provider",
            "prepare",
            "acquire_write",
            "hold",
            "insert_message",
            "release",
            "invitation_id",
            "invitations",
            "completed_message"
        ]
    );
    assert!(f.0.lock().unwrap().import.snapshots[0].is_none());
}

#[tokio::test]
async fn stored_message_captures_labels_and_both_pending_reads_around_the_fetch() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.provider = Ok(Some(fetched("message", false)));
        s.import.stored = Some(stored());
        s.import.labels = vec!["INBOX".into()];
        s.import.pending.push_back(vec!["INBOX".into()]);
        s.import.pending.push_back(vec!["STARRED".into()]);
    }
    assert!(matches!(
        svc.process(&message()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "stored",
            "resync_labels",
            "resync_pending",
            "provider",
            "resync_pending",
            "prepare",
            "acquire_write",
            "hold",
            "insert_message",
            "release",
            "completed_message"
        ]
    );
    let s = f.0.lock().unwrap();
    let snapshot = s.import.snapshots[0].as_ref().unwrap();
    assert_eq!(snapshot.stored_labels, ["INBOX"]);
    assert_eq!(snapshot.pending_labels, ["INBOX", "STARRED"]);
}

#[tokio::test]
async fn each_resync_lookup_failure_preserves_its_position_relative_to_provider() {
    for (fault, nth, provider_seen) in [
        ("stored", 1, false),
        ("resync_labels", 1, false),
        ("resync_pending", 1, false),
        ("resync_pending", 2, true),
    ] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.import.stored = Some(stored());
            s.provider = Ok(Some(fetched("message", false)));
            s.import.fail_at.insert(fault, nth);
        }
        failure(
            svc.process(&message()).await,
            true,
            FailureReason::DatabaseQueryFailed,
        );
        assert_eq!(f.calls().contains(&"provider"), provider_seen);
        assert!(!f.calls().contains(&"prepare"));
    }
}

#[tokio::test]
async fn missing_provider_message_and_refused_single_write_have_distinct_dispositions() {
    let (svc, _) = setup();
    failure(
        svc.process(&message()).await,
        false,
        FailureReason::MessageNotFoundInProvider,
    );
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.provider = Ok(Some(fetched("message", false)));
        s.slot = false;
    }
    assert!(matches!(
        svc.process(&message()).await,
        BackfillDisposition::Defer { .. }
    ));
    assert!(!f.calls().contains(&"insert_message"));
}

#[tokio::test]
async fn single_message_write_failure_releases_and_stops_before_invitation_and_contacts() {
    let (svc, f) = setup();
    f.0.lock().unwrap().provider = Ok(Some(fetched("message", true)));
    f.fail("insert_message");
    failure(
        svc.process(&message()).await,
        true,
        FailureReason::DatabaseQueryFailed,
    );
    assert_eq!(f.calls().last(), Some(&"release"));
    assert!(!f.calls().contains(&"invitation_id"));
}

#[tokio::test]
async fn invitation_guards_are_independent_and_lookup_failure_does_not_block_completion() {
    for (draft, parts, lookup_failure, expect_lookup, expect_save) in [
        (true, true, false, false, false),
        (false, false, false, false, false),
        (false, true, true, true, false),
        (false, true, false, true, true),
    ] {
        let (svc, f) = setup();
        let mut m = fetched("message", parts);
        m.message.is_draft = draft;
        f.0.lock().unwrap().provider = Ok(Some(m));
        if lookup_failure {
            f.fail("invitation_id");
        }
        assert!(matches!(
            svc.process(&message()).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(f.calls().contains(&"invitation_id"), expect_lookup);
        assert_eq!(f.calls().contains(&"invitations"), expect_save);
        assert_eq!(f.calls().last(), Some(&"completed_message"));
    }
}

#[tokio::test]
async fn committed_single_message_sends_contacts_before_completion_and_keeps_queue_error_retryable()
{
    let (svc, f) = setup();
    let mut m = fetched("message", false);
    m.message.is_sent = true;
    m.message.to = vec![ContactInfo {
        email: "contact@example.com".into(),
        name: None,
        photo_url: None,
    }];
    f.0.lock().unwrap().provider = Ok(Some(m));
    f.fail("enqueue");
    failure(
        svc.process(&message()).await,
        true,
        FailureReason::SqsEnqueueFailed,
    );
    let c = f.calls();
    assert!(
        c.iter().position(|x| *x == "release").unwrap()
            < c.iter().position(|x| *x == "enqueue").unwrap()
    );
    assert!(!c.contains(&"completed_message"));
}

#[tokio::test]
async fn crm_direction_guards_choose_sent_recipients_and_received_sender_in_order() {
    for (draft, sent) in [(true, true), (false, true), (false, false)] {
        let (svc, f) = setup();
        let mut m = fetched("message", false).message;
        m.is_draft = draft;
        m.is_sent = sent;
        m.to = vec![ContactInfo {
            email: "to@example.com".into(),
            name: None,
            photo_url: None,
        }];
        m.cc = vec![ContactInfo {
            email: "cc@example.com".into(),
            name: None,
            photo_url: None,
        }];
        m.bcc = vec![ContactInfo {
            email: "bcc@example.com".into(),
            name: None,
            photo_url: None,
        }];
        m.from = Some(ContactInfo {
            email: "from@example.com".into(),
            name: None,
            photo_url: None,
        });
        super::super::message::enqueue_crm_contacts(&svc, &link(), &m)
            .await
            .unwrap();
        let s = f.0.lock().unwrap();
        let emails = s
            .sent
            .iter()
            .map(|(msg, _)| match &msg.backfill_operation {
                BackfillOperation::PopulateCrmContact(p) => p.payload.contact_email.as_str(),
                _ => panic!("contact"),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            emails,
            if draft {
                vec![]
            } else if sent {
                vec!["to@example.com", "cc@example.com", "bcc@example.com"]
            } else {
                vec!["from@example.com"]
            }
        );
    }
}

#[tokio::test]
async fn received_message_without_sender_has_no_contact_send() {
    let (svc, f) = setup();
    super::super::message::enqueue_crm_contacts(&svc, &link(), &fetched("message", false).message)
        .await
        .unwrap();
    assert!(f.0.lock().unwrap().sent.is_empty());
}
