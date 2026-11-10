use super::{
    fakes::{Call, LINK, MESSAGE, THREAD, input, make_service},
    import_fakes::received_message,
    *,
};
use email_api_client::domain::models::{EmailApiError, MessageWithCalendarParts, RateLimitOrigin};
fn operation() -> InboxSyncOperation {
    InboxSyncOperation::UpsertMessage(UpsertMessagePayload {
        provider_message_id: "message-1".into(),
    })
}
fn names(calls: &[Call]) -> Vec<&'static str> {
    calls
        .iter()
        .filter_map(|c| {
            if let Call::Import(n, _) = c {
                Some(*n)
            } else {
                None
            }
        })
        .collect()
}
fn setup() -> (
    InboxSyncService<fakes::Fake, fakes::Fake, fakes::Fake, fakes::Fake, fakes::Fake>,
    fakes::Fake,
) {
    let (svc, fake) = make_service(false);
    fake.0.lock().unwrap().import.fetched = Ok(Some(MessageWithCalendarParts {
        message: received_message(LINK, THREAD),
        calendar_parts: vec![],
    }));
    (svc, fake)
}
#[tokio::test]
async fn existing_message_read_failure_is_terminal_and_provider_absence_has_no_effects() {
    let (svc, fake) = setup();
    fake.0.lock().unwrap().failures.push(("message", 1));
    let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
    assert!(delete);
    assert!(error.source.to_string().contains("before provider upsert"));
    let (svc, fake) = make_service(false);
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert_eq!(names(&fake.calls()), vec!["get_message"]);
}
#[tokio::test]
async fn resync_reads_stored_labels_then_both_pending_snapshots_around_the_fetch() {
    let (svc, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        s.pending.push_back(vec!["INBOX".into()]);
        s.import.labels_during_fetch = Some(vec!["STARRED".into()]);
    }
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let calls = fake.calls();
    let at = calls
        .iter()
        .position(|c| matches!(c, Call::Import("get_message", _)))
        .unwrap();
    assert!(matches!(calls[at - 2], Call::Labels));
    assert!(matches!(calls[at - 1], Call::Pending));
    assert!(matches!(calls[at + 1], Call::Pending));
    let snap = calls
        .iter()
        .find_map(|c| {
            if let Call::Import("insert_message", v) = c {
                Some(v)
            } else {
                None
            }
        })
        .unwrap();
    assert!(snap.to_string().contains("STARRED"));
    assert!(snap.to_string().contains("INBOX"));
}
#[tokio::test]
async fn a_resync_after_read_failure_masks_provider_failure_before_routing() {
    let (svc, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        s.import.fetched = Err(EmailApiError::Forbidden);
        s.failures.push(("pending", 2));
    }
    let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
    assert!(!delete);
    assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
    assert!(
        !fake
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Enqueue(_, _)))
    );
}
#[tokio::test]
async fn insertion_paths_keep_prepare_insert_lookup_invitation_order() {
    for whole_thread in [false, true] {
        let (svc, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.import.thread_exists = !whole_thread;
            s.import.thread_messages = Ok(vec![MessageWithCalendarParts {
                message: received_message(LINK, THREAD),
                calendar_parts: vec![],
            }]);
        }
        assert!(matches!(
            svc.process(Ok(input(operation()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        let n = names(&fake.calls());
        let first = if whole_thread {
            "prepare_threads"
        } else {
            "prepare_message"
        };
        let insert = if whole_thread {
            "insert_thread"
        } else {
            "insert_message"
        };
        assert!(n.iter().position(|n| *n == first) < n.iter().position(|n| *n == insert));
        assert!(n.iter().position(|n| *n == insert) < n.iter().position(|n| *n == "message_ids"));
        assert!(
            n.iter().position(|n| *n == "message_ids") < n.iter().position(|n| *n == "invitations")
        );
    }
}
#[tokio::test]
async fn upsert_query_and_insert_failures_keep_their_original_classification() {
    for (step, terminal, whole_thread) in [
        ("thread_ids", false, false),
        ("insert_message", false, false),
        ("insert_thread", false, true),
        ("message_ids", true, false),
    ] {
        let (svc, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.import.thread_exists = !whole_thread;
            s.failures.push((step, 1));
        }
        let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
        assert_eq!(delete, terminal);
        assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
        assert_eq!(names(&fake.calls()).last(), Some(&step));
    }
}
#[tokio::test]
async fn provider_refusals_use_the_same_retry_policy_for_message_and_thread_reads() {
    for retry in [false, true] {
        for thread in [false, true] {
            let (mut svc, fake) = setup();
            svc.retry_worker = retry;
            {
                let mut s = fake.0.lock().unwrap();
                let err = EmailApiError::RateLimited {
                    retry_after: None,
                    origin: RateLimitOrigin::Local,
                };
                if thread {
                    s.import.thread_exists = false;
                    s.import.thread_messages = Err(err);
                } else {
                    s.import.fetched = Err(err);
                }
            }
            let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
            assert_eq!(delete, !retry);
            assert_eq!(error.reason, FailureReason::GmailApiRateLimited);
            assert_eq!(
                fake.calls()
                    .iter()
                    .filter(|c| matches!(c, Call::Enqueue(true, _)))
                    .count(),
                usize::from(!retry)
            );
        }
    }
}
#[tokio::test]
async fn drafts_skip_invitation_saving_and_mutable_drafts_always_publish() {
    for previous in [false, true] {
        let (svc, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            if !previous {
                s.message = None;
            }
            s.import
                .fetched
                .as_mut()
                .unwrap()
                .as_mut()
                .unwrap()
                .message
                .is_draft = true;
        }
        assert!(matches!(
            svc.process(Ok(input(operation()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        assert!(!names(&fake.calls()).contains(&"invitations"));
        assert!(
            fake.calls().iter().any(
                |c| matches!(c,Call::Event(v)if v["event_type"]=="email.message_draft_synced")
            )
        );
    }
}
#[tokio::test]
async fn immutable_redelivery_does_not_publish_or_notify_again() {
    let (mut svc, fake) = setup();
    svc.features.notifications_enabled = true;
    fake.0.lock().unwrap().message = None;
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    fake.0.lock().unwrap().calls.clear();
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert!(
        !fake
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Event(_) | Call::Import("notify", _)))
    );
}
#[tokio::test]
async fn attachment_gates_skip_claims_and_query_failures_stop_publication() {
    let (mut svc, fake) = setup();
    svc.features.attachment_upload = true;
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert!(!names(&fake.calls()).contains(&"documents"));
}
#[tokio::test]
async fn notifications_select_signal_partitions_and_filter_sent_or_missing_messages() {
    let (mut svc, fake) = setup();
    svc.features.notifications_enabled = true;
    {
        let mut s = fake.0.lock().unwrap();
        s.message = None;
        s.import.previews.push_back(true);
        s.import.primaries = vec![
            "macro|staff@macro.com".into(),
            "macro|delegate@example.com".into(),
            "invalid".into(),
        ];
    }
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let calls = fake.calls();
    let n: Vec<_> = calls
        .iter()
        .filter_map(|c| {
            if let Call::Import("notify", v) = c {
                Some(v)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(n.len(), 2);
    assert_eq!(n[0][1], true);
    assert_eq!(n[0][2], true);
    assert_eq!(n[1][1], true);
    assert_eq!(n[1][2], false);
}

fn parsed_attachment() -> models_email::service::attachment::Attachment {
    models_email::service::attachment::Attachment {
        db_id: Uuid::from_u128(80),
        provider_id: None,
        data_url: None,
        reference_url: None,
        filename: Some("file.pdf".into()),
        mime_type: Some("application/pdf".into()),
        size_bytes: None,
        sfs_id: None,
        content_id: None,
    }
}
fn claimed(id: u128, mime: &str) -> models_email::service::attachment::AttachmentUploadMetadata {
    models_email::service::attachment::AttachmentUploadMetadata {
        attachment_db_id: Uuid::from_u128(id),
        email_provider_id: "message-1".into(),
        provider_attachment_id: format!("att-{id}"),
        mime_type: mime.into(),
        filename: Some("file.pdf".into()),
        internal_date_ts: Default::default(),
        message_db_id: MESSAGE,
        thread_db_id: THREAD,
        sender_email: None,
        subject: None,
    }
}
fn with_attachments() -> (
    InboxSyncService<fakes::Fake, fakes::Fake, fakes::Fake, fakes::Fake, fakes::Fake>,
    fakes::Fake,
) {
    let (mut svc, fake) = setup();
    svc.features.attachment_upload = true;
    {
        let mut s = fake.0.lock().unwrap();
        s.import
            .fetched
            .as_mut()
            .unwrap()
            .as_mut()
            .unwrap()
            .message
            .attachments
            .push(parsed_attachment());
        s.import.documents = vec![claimed(80, "application/pdf")];
        s.import.media = vec![claimed(81, "image/png"), claimed(82, "image/gif")];
    }
    (svc, fake)
}
#[tokio::test]
async fn attachment_claim_and_recipient_failures_keep_their_distinct_dispositions() {
    for (step, terminal) in [
        ("documents", false),
        ("media", false),
        ("attachment_recipients", true),
    ] {
        let (svc, fake) = with_attachments();
        fake.0.lock().unwrap().failures.push((step, 1));
        let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
        assert_eq!(delete, terminal);
        assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
        assert!(!names(&fake.calls()).contains(&"upload"));
    }
}
#[tokio::test]
async fn a_refused_upload_releases_itself_and_the_untried_suffix_before_retry_routing() {
    let (svc, fake) = with_attachments();
    {
        let mut s = fake.0.lock().unwrap();
        s.import.upload_results.extend([
            Ok("one".into()),
            Err(InboxSyncUploadError::RateLimited(
                EmailApiError::RateLimited {
                    retry_after: None,
                    origin: RateLimitOrigin::Local,
                },
            )),
        ]);
    }
    let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
    assert!(delete);
    assert_eq!(error.reason, FailureReason::GmailApiRateLimited);
    let calls = fake.calls();
    let releases: Vec<_> = calls
        .iter()
        .filter_map(|c| {
            if let Call::Import("release", v) = c {
                Some(v.as_str().unwrap())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        releases,
        vec![
            "00000000-0000-0000-0000-000000000051",
            "00000000-0000-0000-0000-000000000052"
        ]
    );
    assert_eq!(names(&calls).iter().filter(|n| **n == "upload").count(), 2);
    let refresh = calls
        .iter()
        .position(|c| matches!(c, Call::Import("refresh", _)))
        .unwrap();
    let queued = calls
        .iter()
        .position(|c| matches!(c, Call::Enqueue(true, _)))
        .unwrap();
    assert!(refresh < queued);
}
#[tokio::test]
async fn release_failure_prevents_retry_queue_publication() {
    let (svc, fake) = with_attachments();
    {
        let mut s = fake.0.lock().unwrap();
        s.import
            .upload_results
            .push_back(Err(InboxSyncUploadError::RateLimited(
                EmailApiError::RateLimited {
                    retry_after: None,
                    origin: RateLimitOrigin::Local,
                },
            )));
        s.failures.push(("release", 1));
    }
    let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
    assert!(!delete);
    assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
    assert!(
        !fake
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Enqueue(_, _)))
    );
}
#[tokio::test]
async fn deleted_and_other_upload_failures_continue_with_the_remaining_attachments() {
    let (svc, fake) = with_attachments();
    fake.0.lock().unwrap().import.upload_results.extend([
        Err(InboxSyncUploadError::AttachmentDeleted),
        Err(InboxSyncUploadError::Other(Box::new(
            std::io::Error::other("failed"),
        ))),
        Ok("last".into()),
    ]);
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let n = names(&fake.calls());
    assert_eq!(n.iter().filter(|n| **n == "upload").count(), 3);
    assert!(!n.contains(&"release"));
}
#[tokio::test]
async fn crm_fanout_normalizes_deduplicates_and_omits_self_and_invalid_addresses() {
    let (svc, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        let msg = &mut s.import.fetched.as_mut().unwrap().as_mut().unwrap().message;
        msg.is_sent = true;
        msg.to = [
            " Friend@Example.com ",
            "friend@example.com",
            "Owner@example.com",
            "bad",
            "x@@example.com",
        ]
        .into_iter()
        .map(|email| models_email::service::address::ContactInfo {
            email: email.into(),
            name: Some("friend".into()),
            photo_url: None,
        })
        .collect();
    }
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let sends: Vec<_> = fake
        .calls()
        .into_iter()
        .filter_map(|c| {
            if let Call::Import("backfill_queue", v) = c {
                Some(v)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(sends.len(), 1);
    assert!(sends[0].to_string().contains("friend@example.com"));
    assert!(sends[0].to_string().contains("friend"));
}
#[tokio::test]
async fn a_failed_crm_fanout_remains_retryable_after_the_message_was_committed() {
    let (svc, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        s.import
            .fetched
            .as_mut()
            .unwrap()
            .as_mut()
            .unwrap()
            .message
            .from = Some(models_email::service::address::ContactInfo {
            email: "friend@example.com".into(),
            name: None,
            photo_url: None,
        });
        s.failures.push(("backfill_queue", 1));
    }
    let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
    assert!(!delete);
    assert_eq!(error.reason, FailureReason::SqsEnqueueFailed);
    let n = names(&fake.calls());
    assert!(n.contains(&"insert_message"));
    assert!(!n.contains(&"refresh"));
}
#[tokio::test]
async fn contact_connections_follow_direction_and_enqueue_failure_is_terminal() {
    let (mut svc, fake) = setup();
    svc.features.contacts_sync = true;
    {
        let mut s = fake.0.lock().unwrap();
        s.import
            .fetched
            .as_mut()
            .unwrap()
            .as_mut()
            .unwrap()
            .message
            .from = Some(models_email::service::address::ContactInfo {
            email: "friend@example.com".into(),
            name: None,
            photo_url: None,
        });
        s.failures.push(("connect", 1));
    }
    let (delete, error) = failure(svc.process(Ok(input(operation()))).await);
    assert!(delete);
    assert_eq!(error.reason, FailureReason::SqsEnqueueFailed);
    assert!(
        error
            .source
            .to_string()
            .contains("Failed to enqueue contacts message")
    );
}
#[tokio::test]
async fn notification_query_failures_retry_after_the_insert_and_publication_failure_is_best_effort()
{
    for step in [
        "message",
        "sender_contacts",
        "previews",
        "primaries",
        "notify",
    ] {
        let (mut svc, fake) = setup();
        svc.features.notifications_enabled = true;
        {
            let mut s = fake.0.lock().unwrap();
            s.message = None;
            s.import.previews.push_back(true);
            s.failures
                .push((step, if step == "message" { 2 } else { 1 }));
        }
        let outcome = svc.process(Ok(input(operation()))).await;
        if step == "notify" {
            assert!(matches!(outcome, InboxSyncDisposition::DoneDelete));
        } else {
            let (delete, error) = failure(outcome);
            assert!(!delete);
            assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
        }
        assert!(names(&fake.calls()).contains(&"insert_message"));
    }
}

#[tokio::test]
async fn staff_inbox_notifications_keep_both_partitions_without_realtime_or_apns() {
    let (mut svc, fake) = setup();
    svc.features.notifications_enabled = true;
    {
        let mut s = fake.0.lock().unwrap();
        s.link.as_mut().unwrap().macro_id =
            MacroUserIdStr::try_from("macro|staff@macro.com".to_owned()).unwrap();
        s.message = None;
        s.import.previews.extend([false, true]);
        s.import.primaries = vec!["macro|delegate@example.com".into()];
    }
    assert!(matches!(
        svc.process(Ok(input(operation()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let calls = fake.calls();
    let n: Vec<_> = calls
        .iter()
        .filter_map(|c| {
            if let Call::Import("notify", v) = c {
                Some(v)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(n.len(), 2);
    assert!(n.iter().all(|v| v[1] == false && v[2] == false));
}
#[tokio::test]
async fn sent_draft_or_missing_committed_messages_never_query_notification_tiers() {
    for kind in 0..3 {
        let (mut svc, fake) = setup();
        svc.features.notifications_enabled = true;
        {
            let mut s = fake.0.lock().unwrap();
            s.message = None;
            if kind == 0 {
                s.import.committed = None;
            } else {
                let message = s.import.committed.as_mut().unwrap();
                message.is_sent = kind == 1;
                message.is_draft = kind == 2;
            }
        }
        assert!(matches!(
            svc.process(Ok(input(operation()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        let n = names(&fake.calls());
        assert!(!n.contains(&"sender_contacts"));
        assert!(!n.contains(&"previews"));
        assert!(!n.contains(&"notify"));
    }
}

#[tokio::test]
async fn whole_thread_construction_keeps_message_order_flags_and_shared_thread_identity() {
    for empty in [false, true] {
        let (svc, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.import.thread_exists = false;
            let mut first = received_message(LINK, THREAD);
            first.provider_id = Some("early".into());
            first.internal_date_ts = Some(chrono::DateTime::from_timestamp(10, 0).unwrap());
            first.is_sent = true;
            first.is_read = true;
            first.labels.clear();
            let mut second = received_message(LINK, THREAD);
            second.provider_id = Some("late".into());
            second.internal_date_ts = Some(chrono::DateTime::from_timestamp(20, 0).unwrap());
            second.is_read = false;
            second.labels = vec![super::fakes::label("INBOX").into()];
            s.import.thread_messages = Ok(if empty {
                vec![]
            } else {
                vec![
                    MessageWithCalendarParts {
                        message: second,
                        calendar_parts: vec![],
                    },
                    MessageWithCalendarParts {
                        message: first,
                        calendar_parts: vec![],
                    },
                ]
            });
            if empty {
                s.failures.push(("message_ids", 1));
            }
        }
        let _ = svc.process(Ok(input(operation()))).await;
        let calls = fake.calls();
        let thread = calls
            .iter()
            .find_map(|c| {
                if let Call::Import("insert_thread", v) = c {
                    Some(v)
                } else {
                    None
                }
            })
            .unwrap();
        assert_eq!(thread["inbox_visible"], !empty);
        assert_eq!(thread["is_read"], empty);
        if empty {
            assert!(thread["messages"].as_array().unwrap().is_empty());
            assert!(thread["latest_inbound_message_ts"].is_null());
        } else {
            assert_eq!(thread["messages"][0]["provider_id"], "early");
            assert_eq!(thread["messages"][1]["provider_id"], "late");
            assert_eq!(thread["messages"][0]["thread_db_id"], thread["db_id"]);
            assert_eq!(thread["messages"][1]["thread_db_id"], thread["db_id"]);
        }
    }
}
