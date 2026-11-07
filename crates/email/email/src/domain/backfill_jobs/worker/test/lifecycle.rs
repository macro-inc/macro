use super::*;
use models_email::service::{attachment::AttachmentUploadMetadata, label::Label};
use tokio::sync::oneshot;

fn init() -> BackfillPubsubMessage {
    input(BackfillOperation::Init(scope(InitPayload {})))
}
fn finalize() -> BackfillPubsubMessage {
    input(BackfillOperation::FinalizeBackfill(scope(
        FinalizeBackfillPayload {},
    )))
}
fn metadata_row() -> AttachmentUploadMetadata {
    let BackfillOperation::BackfillAttachment(p) = attachment().backfill_operation else {
        panic!("attachment")
    };
    p.payload.metadata.attachment_metadata
}
fn label() -> Label {
    Label {
        id: Some(Uuid::from_u128(70)),
        link_id: LINK,
        provider_label_id: "label".into(),
        name: Some("Label".into()),
        created_at: Default::default(),
        message_list_visibility: None,
        label_list_visibility: None,
        type_: Some(models_email::service::label::LabelType::User),
    }
}

#[tokio::test]
async fn init_claim_outcomes_stop_before_provider_work() {
    for (claim, reason) in [
        (InitLeaseClaim::Complete, None),
        (
            InitLeaseClaim::Busy,
            Some(FailureReason::EmailBackfillInitBusy),
        ),
        (
            InitLeaseClaim::NotFound,
            Some(FailureReason::BackfillJobNotFound),
        ),
    ] {
        let (svc, f) = setup();
        f.0.lock().unwrap().lifecycle.claim = claim;
        let result = svc.process(&init()).await;
        if let Some(reason) = reason {
            failure(
                result,
                reason == FailureReason::EmailBackfillInitBusy,
                reason,
            );
        } else {
            assert!(matches!(result, BackfillDisposition::DoneDelete));
        }
        assert_eq!(f.calls(), ["job", "link", "init"]);
    }
    let (svc, f) = setup();
    f.fail("init");
    failure(
        svc.process(&init()).await,
        true,
        FailureReason::DatabaseQueryFailed,
    );
    assert_eq!(f.calls(), ["job", "link", "init"]);
}

#[tokio::test]
async fn initialization_preserves_catalog_contacts_count_and_outbox_order() {
    let (svc, f) = setup();
    f.0.lock().unwrap().lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
    assert!(matches!(
        svc.process(&init()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "init",
            "provider_labels",
            "catalog",
            "sync_contacts",
            "colleague_dms",
            "thread_count",
            "update_total",
            "init_progress",
            "finalize_init"
        ]
    );
    assert_eq!(f.0.lock().unwrap().lifecycle.totals, [1]);
}

#[tokio::test]
async fn requested_limits_preserve_minimum_including_zero_and_negative_values() {
    for (limit, provider, expected) in [
        (None, 9, 9),
        (Some(3), 9, 3),
        (Some(12), 9, 9),
        (Some(0), 9, 0),
        (Some(-1), 9, -1),
    ] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
            s.lifecycle.thread_count = provider;
            s.job.as_mut().unwrap().threads_requested_limit = limit;
        }
        assert!(matches!(
            svc.process(&init()).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(f.0.lock().unwrap().lifecycle.totals, [expected]);
        if expected == 0 {
            assert_eq!(f.calls().last(), Some(&"completed_job"));
            assert!(!f.calls().contains(&"init_progress"));
        } else {
            assert_eq!(f.calls().last(), Some(&"finalize_init"));
        }
    }
}

#[tokio::test]
async fn init_errors_release_the_claim_and_stop_later_work() {
    for (fault, reason) in [
        ("provider_labels", FailureReason::GmailApiFailed),
        ("catalog", FailureReason::DatabaseQueryFailed),
        ("thread_count", FailureReason::GmailApiFailed),
        ("update_total", FailureReason::DatabaseQueryFailed),
        ("init_progress", FailureReason::RedisQueryFailed),
        ("finalize_init", FailureReason::DatabaseQueryFailed),
    ] {
        let (svc, f) = setup();
        f.0.lock().unwrap().lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
        f.fail(fault);
        failure(svc.process(&init()).await, true, reason);
        let calls = f.calls();
        assert_eq!(calls.last(), Some(&"release_init"));
        assert_eq!(calls[calls.len() - 2], fault);
    }
}

#[tokio::test]
async fn init_catalog_deletion_and_upsert_failures_release_the_claim() {
    for fault in ["delete_catalog", "upsert_catalog"] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
            if fault == "delete_catalog" {
                s.lifecycle.stored_labels = vec![label()];
            } else {
                s.lifecycle.labels = vec![label()];
            }
        }
        f.fail(fault);
        failure(
            svc.process(&init()).await,
            true,
            FailureReason::DatabaseQueryFailed,
        );
        assert_eq!(f.calls().last(), Some(&"release_init"));
        assert!(!f.calls().contains(&"sync_contacts"));
    }
}

#[tokio::test]
async fn contacts_failure_remains_best_effort_and_skips_colleague_dms() {
    let (svc, f) = setup();
    f.0.lock().unwrap().lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
    f.fail("sync_contacts");
    assert!(matches!(
        svc.process(&init()).await,
        BackfillDisposition::DoneDelete
    ));
    assert!(!f.calls().contains(&"colleague_dms"));
    assert_eq!(f.calls().last(), Some(&"finalize_init"));
}

#[tokio::test]
async fn init_overflow_and_lost_finalization_keep_their_original_errors() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
        s.lifecycle.thread_count = i32::MAX as u64 + 1;
    }
    let e = failure(
        svc.process(&init()).await,
        false,
        FailureReason::InvalidData,
    );
    assert_eq!(e.source.to_string(), "Provider thread count exceeds i32");
    assert!(!f.calls().contains(&"update_total"));
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
        s.lifecycle.finalize = false;
    }
    failure(
        svc.process(&init()).await,
        true,
        FailureReason::EmailBackfillInitBusy,
    );
    assert_eq!(f.calls().last(), Some(&"release_init"));
}

#[tokio::test(start_paused = true)]
async fn init_lease_heartbeat_keeps_each_renewal_outcome() {
    for renewal in [
        InitLeaseRenewal::Complete,
        InitLeaseRenewal::Lost,
        InitLeaseRenewal::NotFound,
        InitLeaseRenewal::Renewed,
    ] {
        let (svc, f) = setup();
        let (arrived_tx, arrived_rx) = oneshot::channel();
        let (resume_tx, resume_rx) = oneshot::channel();
        {
            let mut s = f.0.lock().unwrap();
            s.lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
            s.lifecycle.renew = renewal;
            s.lifecycle.contact_gate = Some((arrived_tx, resume_rx));
        }
        let task = tokio::spawn(async move { svc.process(&init()).await });
        arrived_rx.await.unwrap();
        tokio::time::advance(std::time::Duration::from_secs(30)).await;
        if renewal == InitLeaseRenewal::Renewed {
            resume_tx.send(()).unwrap();
        } else {
            drop(resume_tx);
        }
        let result = task.await.unwrap();
        assert!(f.calls().contains(&"renew_init"));
        match renewal {
            InitLeaseRenewal::Lost => {
                failure(result, true, FailureReason::EmailBackfillInitBusy);
            }
            InitLeaseRenewal::NotFound => {
                failure(result, false, FailureReason::BackfillJobNotFound);
            }
            _ => assert!(matches!(result, BackfillDisposition::DoneDelete)),
        }
    }
}

#[tokio::test]
async fn completion_claim_pending_and_status_guards_are_distinct() {
    let (svc, f) = setup();
    assert!(matches!(
        svc.process(&finalize()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["finalize", "completion_pending"]);
    let (svc, f) = setup();
    f.0.lock().unwrap().lifecycle.completion_pending = true;
    failure(
        svc.process(&finalize()).await,
        true,
        FailureReason::DatabaseQueryFailed,
    );
    for status in [
        BackfillJobStatus::Init,
        BackfillJobStatus::InProgress,
        BackfillJobStatus::Failed,
        BackfillJobStatus::Cancelled,
    ] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.lifecycle.completion_token = Some(Uuid::from_u128(80));
            s.job.as_mut().unwrap().status = status;
        }
        let result = svc.process(&finalize()).await;
        if matches!(
            status,
            BackfillJobStatus::Failed | BackfillJobStatus::Cancelled
        ) {
            assert!(matches!(result, BackfillDisposition::DoneDelete));
            assert_eq!(f.calls(), ["finalize", "job", "retire_completion"]);
        } else {
            failure(result, true, FailureReason::DatabaseQueryFailed);
            assert_eq!(f.calls(), ["finalize", "job", "release_completion"]);
        }
    }
}

#[tokio::test]
async fn completed_job_uses_its_canonical_link_and_orders_effects_before_retirement() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.lifecycle.completion_token = Some(Uuid::from_u128(80));
        s.job.as_mut().unwrap().status = BackfillJobStatus::Complete;
    }
    let mut input = finalize();
    let BackfillOperation::FinalizeBackfill(ref mut scope) = input.backfill_operation else {
        panic!("finalize")
    };
    scope.link_id = Uuid::from_u128(999);
    assert!(matches!(
        svc.process(&input).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "finalize",
            "job",
            "link",
            "job_attachments",
            "contact_emails",
            "connect_contacts",
            "top_contact_dms",
            "refresh_progress",
            "retire_completion"
        ]
    );
    assert!(matches!(
        f.0.lock().unwrap().lifecycle.refreshes[0],
        (
            LINK,
            BackfillProgress {
                job_complete: true,
                completed_threads: 1,
                total_threads: 1,
            }
        )
    ));
}

#[tokio::test]
async fn completion_missing_job_does_not_retire_but_missing_links_do() {
    for absence in ["job", "job_link", "link"] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.lifecycle.completion_token = Some(Uuid::from_u128(80));
            if absence == "job" {
                s.job = None;
            } else {
                s.job.as_mut().unwrap().status = BackfillJobStatus::Complete;
                if absence == "job_link" {
                    s.job.as_mut().unwrap().link_id = None;
                } else {
                    s.link = None;
                }
            }
        }
        assert!(matches!(
            svc.process(&finalize()).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(f.calls().contains(&"retire_completion"), absence != "job");
    }
}

#[tokio::test]
async fn completion_failures_retry_and_release_without_later_effects() {
    for fault in [
        "job",
        "link",
        "job_attachments",
        "contact_emails",
        "connect_contacts",
        "retire_completion",
    ] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.lifecycle.completion_token = Some(Uuid::from_u128(80));
            s.job.as_mut().unwrap().status = BackfillJobStatus::Complete;
        }
        f.fail(fault);
        let result = svc.process(&finalize()).await;
        let reason = if fault == "connect_contacts" {
            FailureReason::SqsEnqueueFailed
        } else {
            FailureReason::DatabaseQueryFailed
        };
        failure(result, true, reason);
        assert_eq!(f.calls().last(), Some(&"release_completion"));
    }
}

#[tokio::test]
async fn thread_progress_refreshes_first_and_every_fiftieth_then_completes() {
    for (count, refresh) in [(1, true), (49, false), (50, true), (51, false), (100, true)] {
        let (svc, f) = setup();
        f.0.lock().unwrap().lifecycle.progress.completed_threads = count;
        super::super::counters::incr_completed_threads(&svc, &link(), JOB)
            .await
            .unwrap();
        assert_eq!(f.calls().contains(&"refresh_progress"), refresh);
    }
    let (svc, f) = setup();
    f.0.lock().unwrap().lifecycle.progress.job_complete = true;
    super::super::counters::incr_completed_threads(&svc, &link(), JOB)
        .await
        .unwrap();
    assert_eq!(f.calls(), ["completed_thread", "completed_job"]);
}

#[tokio::test]
async fn completed_message_enqueues_metadata_before_attachments() {
    let (svc, f) = setup();
    f.0.lock().unwrap().lifecycle.message_complete = true;
    let p = BackfillMessagePayload {
        thread_db_id: Uuid::from_u128(40),
        thread_provider_id: "thread".into(),
        message_provider_id: "message".into(),
    };
    super::super::counters::incr_completed_messages(&svc, &link(), JOB, &p)
        .await
        .unwrap();
    assert_eq!(
        f.calls(),
        [
            "completed_message",
            "enqueue_metadata",
            "thread_attachments"
        ]
    );
}

#[tokio::test]
async fn feature_switches_skip_only_their_own_effects() {
    let (mut svc, f) = setup();
    svc.attachment_upload = false;
    svc.contacts_sync = false;
    {
        let mut s = f.0.lock().unwrap();
        s.lifecycle.completion_token = Some(Uuid::from_u128(80));
        s.job.as_mut().unwrap().status = BackfillJobStatus::Complete;
    }
    assert!(matches!(
        svc.process(&finalize()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "finalize",
            "job",
            "link",
            "top_contact_dms",
            "refresh_progress",
            "retire_completion"
        ]
    );
}

#[tokio::test]
async fn attachment_destinations_and_recipient_filters_preserve_input_order() {
    use models_email::{
        db::{address::EmailRecipientType, contact::Contact},
        service::attachment::AttachmentUploadDestination,
    };
    let (svc, f) = setup();
    let mut rows = vec![];
    for kind in ["image/png", "video/mp4", "application/pdf"] {
        let mut a = metadata_row();
        a.mime_type = kind.into();
        rows.push(a);
    }
    let contact = |email: Option<&str>| Contact {
        id: Uuid::nil(),
        link_id: LINK,
        name: None,
        email_address: email.map(str::to_owned),
        original_photo_url: None,
        sfs_photo_url: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    };
    {
        let mut s = f.0.lock().unwrap();
        s.lifecycle.attachments = rows;
        s.lifecycle.recipients.insert(
            Uuid::from_u128(60),
            vec![
                (contact(Some("to@example.com")), EmailRecipientType::To),
                (contact(Some("cc@example.com")), EmailRecipientType::Cc),
                (contact(None), EmailRecipientType::To),
            ],
        );
    }
    super::super::followups::handle_thread_attachment_upload(
        &svc,
        &link(),
        JOB,
        Uuid::from_u128(40),
    )
    .await
    .unwrap();
    let s = f.0.lock().unwrap();
    assert_eq!(s.sent.len(), 3);
    for ((message, _), expected) in s.sent.iter().zip([
        AttachmentUploadDestination::Sfs,
        AttachmentUploadDestination::Sfs,
        AttachmentUploadDestination::Dss,
    ]) {
        let BackfillOperation::BackfillAttachment(p) = &message.backfill_operation else {
            panic!("attachment")
        };
        assert_eq!(p.payload.metadata.recipient_emails, ["to@example.com"]);
        assert_eq!(p.payload.metadata.upload_destination, expected);
        assert!(p.payload.metadata.backfill);
    }
}

#[tokio::test]
async fn attachment_debug_events_keep_their_count_identifier_and_span_once() {
    use tracing::instrument::WithSubscriber;
    for job in [false, true] {
        let (svc, f) = setup();
        f.0.lock().unwrap().lifecycle.attachments = vec![metadata_row()];
        let output = super::events::Output::default();
        async {
            if job {
                super::super::followups::handle_attachment_upload(&svc, &link(), JOB)
                    .await
                    .unwrap();
            } else {
                super::super::followups::handle_thread_attachment_upload(
                    &svc,
                    &link(),
                    JOB,
                    Uuid::from_u128(40),
                )
                .await
                .unwrap();
            }
        }
        .with_subscriber(super::events::subscriber(&output))
        .await;
        let expected = if job {
            format!("Found 1 condition 5 attachments to backfill for job {JOB}")
        } else {
            format!(
                "Found 1 attachments to backfill for thread {}",
                Uuid::from_u128(40)
            )
        };
        let all = super::events::lines(&output);
        let events: Vec<_> = all.lines().filter(|line| line.contains("Found ")).collect();
        assert_eq!(events.len(), 1);
        assert!(events[0].starts_with("DEBUG "));
        assert!(events[0].ends_with(&expected));
        assert!(events[0].contains(if job {
            "handle_attachment_upload"
        } else {
            "handle_thread_attachment_upload"
        }));
        assert!(events[0].contains(&format!("job_id={JOB}")));
    }
}

#[tokio::test]
async fn empty_attachment_sets_emit_no_debug_event_or_recipient_query() {
    use tracing::instrument::WithSubscriber;
    let (svc, f) = setup();
    let output = super::events::Output::default();
    super::super::followups::handle_thread_attachment_upload(
        &svc,
        &link(),
        JOB,
        Uuid::from_u128(40),
    )
    .with_subscriber(super::events::subscriber(&output))
    .await
    .unwrap();
    assert_eq!(super::events::lines(&output), "");
    assert_eq!(f.calls(), ["thread_attachments"]);
}

#[tokio::test]
async fn contacts_skip_malformed_addresses_and_keep_valid_order_and_duplicates() {
    let (svc, f) = setup();
    f.0.lock().unwrap().lifecycle.emails = vec![
        "'quoted@example.com'".into(),
        "Alice@Example.com".into(),
        ",lead@example.com".into(),
        "bob@example.com".into(),
        "Alice@Example.com".into(),
    ];
    super::super::followups::handle_contacts_sync(&svc, &link())
        .await
        .unwrap();
    assert_eq!(
        f.0.lock()
            .unwrap()
            .lifecycle
            .connections
            .iter()
            .map(|u| u.as_ref())
            .collect::<Vec<_>>(),
        [
            "macro|alice@example.com",
            "macro|bob@example.com",
            "macro|alice@example.com"
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn renewal_failure_releases_initialization_and_keeps_its_original_error() {
    let (svc, f) = setup();
    let (arrived_tx, arrived_rx) = oneshot::channel();
    let (_resume, resume_rx) = oneshot::channel();
    {
        let mut s = f.0.lock().unwrap();
        s.lifecycle.claim = InitLeaseClaim::Claimed(Uuid::from_u128(80));
        s.lifecycle.contact_gate = Some((arrived_tx, resume_rx));
    }
    f.fail("renew_init");
    f.fail("release_init");
    let task = tokio::spawn(async move { svc.process(&init()).await });
    arrived_rx.await.unwrap();
    tokio::time::advance(std::time::Duration::from_secs(30)).await;
    let error = failure(
        task.await.unwrap(),
        true,
        FailureReason::DatabaseQueryFailed,
    );
    assert_eq!(error.source.to_string(), "renew_init");
    assert_eq!(f.calls().last(), Some(&"release_init"));
}

#[tokio::test(start_paused = true)]
async fn completion_heartbeat_failure_releases_and_does_not_retire_effects() {
    for query_error in [false, true] {
        let (svc, f) = setup();
        let (arrived_tx, arrived_rx) = oneshot::channel();
        let (_resume, resume_rx) = oneshot::channel();
        {
            let mut s = f.0.lock().unwrap();
            s.lifecycle.completion_token = Some(Uuid::from_u128(80));
            s.job.as_mut().unwrap().status = BackfillJobStatus::Complete;
            s.lifecycle.renew_completion = false;
            s.lifecycle.contact_gate = Some((arrived_tx, resume_rx));
        }
        if query_error {
            f.fail("renew_completion");
        }
        let task = tokio::spawn(async move { svc.process(&finalize()).await });
        arrived_rx.await.unwrap();
        tokio::time::advance(std::time::Duration::from_secs(30)).await;
        let error = failure(
            task.await.unwrap(),
            true,
            FailureReason::DatabaseQueryFailed,
        );
        assert_eq!(
            error.source.to_string(),
            if query_error {
                "Failed to renew backfill completion-effects lease"
            } else {
                "backfill completion-effects lease was lost"
            }
        );
        assert!(!f.calls().contains(&"retire_completion"));
        assert_eq!(f.calls().last(), Some(&"release_completion"));
    }
}

#[tokio::test]
async fn completion_result_preserves_all_atomic_transition_outcomes() {
    for outcome in [
        BackfillCompletion::Completed,
        BackfillCompletion::AlreadyTerminal,
        BackfillCompletion::LeaseLost,
        BackfillCompletion::NotFound,
    ] {
        let (svc, f) = setup();
        f.0.lock().unwrap().lifecycle.completion = outcome;
        let result =
            super::super::completion::handle_job_completed(&svc, JOB, Some(Uuid::from_u128(80)))
                .await;
        match outcome {
            BackfillCompletion::Completed | BackfillCompletion::AlreadyTerminal => {
                assert!(result.is_ok())
            }
            BackfillCompletion::LeaseLost => assert!(matches!(
                result,
                Err(models_email::service::pubsub::ProcessingError::Retryable(
                    DetailedError {
                        reason: FailureReason::EmailBackfillInitBusy,
                        ..
                    }
                ))
            )),
            BackfillCompletion::NotFound => assert!(matches!(
                result,
                Err(
                    models_email::service::pubsub::ProcessingError::NonRetryable(DetailedError {
                        reason: FailureReason::BackfillJobNotFound,
                        ..
                    })
                )
            )),
        }
    }
}
