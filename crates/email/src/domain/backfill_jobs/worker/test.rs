use super::*;
use models_email::service::{
    backfill::*,
    pubsub::{DetailedError, FailureReason},
};
use uuid::Uuid;
mod events;
mod fakes;
mod import_fakes;
mod imports;
mod lifecycle;
mod lifecycle_fakes;
mod listing;
mod seed_attachment;
use fakes::*;

fn failure(
    disposition: BackfillDisposition,
    retryable: bool,
    reason: FailureReason,
) -> DetailedError {
    let error = match disposition {
        BackfillDisposition::FailureDelete(e) if !retryable => e,
        BackfillDisposition::LeaveForRedelivery(e) if retryable => e,
        _ => panic!("unexpected disposition"),
    };
    assert_eq!(error.reason, reason);
    error
}

#[tokio::test]
async fn malformed_decode_preserves_the_original_error_and_does_no_work() {
    let (svc, f) = setup();
    let error = svc
        .decode(Err(anyhow::anyhow!("bad payload").context("bad body")))
        .unwrap_err();
    assert_eq!(format!("{error:#}"), "bad body: bad payload");
    assert!(f.calls().is_empty());
}

#[tokio::test]
async fn missing_and_failed_job_reads_have_distinct_dispositions() {
    let (svc, f) = setup();
    f.0.lock().unwrap().job = None;
    assert_eq!(
        failure(
            svc.process(&metadata()).await,
            false,
            FailureReason::BackfillJobNotFound
        )
        .source
        .to_string(),
        "Backfill job not found"
    );
    assert_eq!(f.calls(), ["job"]);
    let (svc, f) = setup();
    f.fail("job");
    assert_eq!(
        failure(
            svc.process(&metadata()).await,
            true,
            FailureReason::DatabaseQueryFailed
        )
        .source
        .to_string(),
        "Failed to fetch backfill job"
    );
    assert_eq!(f.calls(), ["job"]);
}

#[tokio::test]
async fn each_terminal_status_skips_ordinary_work_and_drops_progress_even_if_cleanup_fails() {
    for status in [
        BackfillJobStatus::Cancelled,
        BackfillJobStatus::Failed,
        BackfillJobStatus::Complete,
    ] {
        let (svc, f) = setup();
        f.0.lock().unwrap().job.as_mut().unwrap().status = status;
        f.fail("delete_job_progress");
        assert!(matches!(
            svc.process(&metadata()).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(f.calls(), ["job", "delete_job_progress"]);
    }
}

#[tokio::test]
async fn skipped_message_drops_both_job_and_thread_progress() {
    let (svc, f) = setup();
    f.0.lock().unwrap().job.as_mut().unwrap().status = BackfillJobStatus::Cancelled;
    let msg = input(BackfillOperation::BackfillMessage(scope(
        BackfillMessagePayload {
            thread_provider_id: "thread".into(),
            thread_db_id: Uuid::from_u128(40),
            message_provider_id: "message".into(),
        },
    )));
    assert!(matches!(
        svc.process(&msg).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        ["job", "delete_job_progress", "delete_thread_progress"]
    );
}

#[tokio::test]
async fn absent_and_failed_required_link_reads_preserve_error_classes() {
    let (svc, f) = setup();
    f.0.lock().unwrap().link = None;
    failure(
        svc.process(&metadata()).await,
        false,
        FailureReason::LinkNotFound,
    );
    assert_eq!(f.calls(), ["job", "link"]);
    let (svc, f) = setup();
    f.fail("link");
    failure(
        svc.process(&metadata()).await,
        true,
        FailureReason::DatabaseQueryFailed,
    );
    assert_eq!(f.calls(), ["job", "link"]);
}

#[tokio::test]
async fn metadata_commit_precedes_completion_and_event() {
    let (svc, f) = setup();
    assert!(matches!(
        svc.process(&metadata()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "begin",
            "metadata",
            "replying_to",
            "commit",
            "completed_thread",
            "event"
        ]
    );
}

#[tokio::test]
async fn metadata_failure_stops_at_the_failed_query_and_rolls_back() {
    for (fault, expected) in [
        ("begin", vec!["job", "link", "begin"]),
        (
            "metadata",
            vec!["job", "link", "begin", "metadata", "rollback"],
        ),
        (
            "replying_to",
            vec![
                "job",
                "link",
                "begin",
                "metadata",
                "replying_to",
                "rollback",
            ],
        ),
        (
            "commit",
            vec!["job", "link", "begin", "metadata", "replying_to", "commit"],
        ),
        (
            "completed_thread",
            vec![
                "job",
                "link",
                "begin",
                "metadata",
                "replying_to",
                "commit",
                "completed_thread",
            ],
        ),
    ] {
        let (svc, f) = setup();
        f.fail(fault);
        failure(
            svc.process(&metadata()).await,
            true,
            if fault == "completed_thread" {
                FailureReason::RedisQueryFailed
            } else {
                FailureReason::DatabaseQueryFailed
            },
        );
        assert_eq!(f.calls(), expected);
    }
}

#[test]
fn sqlstate_policy_uses_the_first_deterministic_code_in_the_original_chain() {
    for code in ["22001", "22003", "23502", "23514"] {
        let error = super::metadata::map_db_error(
            BackfillDatabaseError {
                source: anyhow::anyhow!("original"),
                sqlstates: vec!["40001".into(), code.into(), "22P02".into()],
            },
            "write",
        );
        let ProcessingError::NonRetryable(e) = error else {
            panic!("terminal")
        };
        assert_eq!(e.reason, FailureReason::InvalidData);
        assert_eq!(
            format!("{:#}", e.source),
            format!("write (deterministic SQLSTATE {code}): original")
        );
    }
    for codes in [vec![], vec!["23503".into(), "23505".into(), "40001".into()]] {
        let ProcessingError::Retryable(e) = super::metadata::map_db_error(
            BackfillDatabaseError {
                source: anyhow::anyhow!("original"),
                sqlstates: codes,
            },
            "write",
        ) else {
            panic!("retryable")
        };
        assert_eq!(e.reason, FailureReason::DatabaseQueryFailed);
        assert_eq!(format!("{:#}", e.source), "write: original");
    }
}

#[tokio::test]
async fn missing_crm_link_is_a_noop_without_a_job_lookup() {
    for msg in [crm_population(), crm_depopulation()] {
        let (svc, f) = setup();
        f.0.lock().unwrap().link = None;
        assert!(matches!(
            svc.process(&msg).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(f.calls(), ["link"]);
    }
}

#[tokio::test]
async fn crm_population_holds_and_releases_the_slot_around_the_service_call() {
    let (svc, f) = setup();
    assert!(matches!(
        svc.process(&crm_population()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        ["link", "team", "acquire", "hold", "populate", "release"]
    );
    let (svc, f) = setup();
    f.fail("populate");
    let BackfillDisposition::Defer { error, retry_after } = svc.process(&crm_population()).await
    else {
        panic!("deferred")
    };
    assert_eq!(error.reason, FailureReason::BackfillWritesBusy);
    assert_eq!(retry_after, None);
    assert_eq!(
        f.calls(),
        ["link", "team", "acquire", "hold", "populate", "release"]
    );
}

#[tokio::test]
async fn refused_and_failed_crm_admission_never_populate() {
    for fail in [false, true] {
        let (svc, f) = setup();
        if fail {
            f.fail("acquire")
        } else {
            f.0.lock().unwrap().slot = false
        };
        let BackfillDisposition::Defer { error, .. } = svc.process(&crm_population()).await else {
            panic!("deferred")
        };
        assert_eq!(error.reason, FailureReason::BackfillWritesBusy);
        assert_eq!(f.calls(), ["link", "team", "acquire"]);
    }
}

#[tokio::test]
async fn crm_no_team_and_remaining_message_guards_stop_before_removal() {
    for msg in [crm_population(), crm_depopulation(), population()] {
        let (svc, f) = setup();
        f.0.lock().unwrap().team = None;
        assert!(matches!(
            svc.process(&msg).await,
            BackfillDisposition::DoneDelete
        ));
        assert!(!f.calls().contains(&"acquire"));
        assert!(!f.calls().contains(&"depopulate"));
        assert!(!f.calls().contains(&"consent"));
    }
    let (svc, f) = setup();
    f.0.lock().unwrap().remaining_messages = true;
    assert!(matches!(
        svc.process(&crm_depopulation()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["link", "team", "remaining"]);
}

#[tokio::test]
async fn crm_queries_fail_in_place_without_following_effects() {
    for (msg, fault, expected) in [
        (crm_population(), "team", vec!["link", "team"]),
        (
            crm_depopulation(),
            "remaining",
            vec!["link", "team", "remaining"],
        ),
        (
            crm_depopulation(),
            "depopulate",
            vec!["link", "team", "remaining", "depopulate"],
        ),
        (population(), "consent", vec!["team", "consent"]),
        (
            population(),
            "sent_contacts",
            vec!["team", "consent", "sent_contacts"],
        ),
        (
            population(),
            "received_contacts",
            vec!["team", "consent", "sent_contacts", "received_contacts"],
        ),
        (depopulation(), "link_by_email", vec!["link_by_email"]),
        (
            depopulation(),
            "depopulate_link",
            vec!["link_by_email", "depopulate_link"],
        ),
    ] {
        let (svc, f) = setup();
        f.fail(fault);
        failure(
            svc.process(&msg).await,
            true,
            FailureReason::DatabaseQueryFailed,
        );
        assert_eq!(f.calls(), expected);
    }
}

#[tokio::test]
async fn historical_contacts_send_sent_before_received_with_shared_normalization() {
    let (svc, f) = setup();
    let at = chrono::DateTime::default();
    {
        let mut s = f.0.lock().unwrap();
        s.sent_contacts = vec![
            (" FIRST@example.com ".into(), Some("first".into()), at, at),
            ("owner@example.com".into(), None, at, at),
            ("bad".into(), None, at, at),
            ("first@example.com".into(), None, at, at),
        ];
        s.received_contacts = vec![("second@example.com".into(), None, at, at)];
    }
    assert!(matches!(
        svc.process(&population()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "team",
            "consent",
            "sent_contacts",
            "enqueue",
            "received_contacts",
            "enqueue"
        ]
    );
    let s = f.0.lock().unwrap();
    assert_eq!(s.sent.len(), 2);
    let BackfillOperation::PopulateCrmContact(first) = &s.sent[0].0.backfill_operation else {
        panic!("contact")
    };
    assert_eq!(first.payload.contact_email, "first@example.com");
    assert_eq!(first.payload.contact_name.as_deref(), Some("first"));
    assert!(first.payload.is_sent);
    let BackfillOperation::PopulateCrmContact(second) = &s.sent[1].0.backfill_operation else {
        panic!("contact")
    };
    assert_eq!(second.payload.contact_email, "second@example.com");
    assert!(!second.payload.is_sent);
}

#[tokio::test]
async fn historical_contacts_require_consent_and_stop_after_send_failure() {
    let (svc, f) = setup();
    f.0.lock().unwrap().consent = false;
    assert!(matches!(
        svc.process(&population()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["team", "consent"]);
    let (svc, f) = setup();
    let at = chrono::DateTime::default();
    f.0.lock().unwrap().sent_contacts = vec![("first@example.com".into(), None, at, at)];
    f.fail("enqueue");
    failure(
        svc.process(&population()).await,
        true,
        FailureReason::SqsEnqueueFailed,
    );
    assert_eq!(f.calls(), ["team", "consent", "sent_contacts", "enqueue"]);
}

#[tokio::test]
async fn depopulation_requires_an_exact_link_and_then_removes_it_in_the_requested_team() {
    let (svc, f) = setup();
    f.0.lock().unwrap().link = None;
    assert!(matches!(
        svc.process(&depopulation()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["link_by_email"]);
    let (svc, f) = setup();
    assert!(matches!(
        svc.process(&depopulation()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["link_by_email", "depopulate_link"]);
}

#[tokio::test]
async fn deferral_preserves_payload_rounds_delay_and_increments_the_last_nonoverflowing_count() {
    let (svc, f) = setup();
    let msg = crm_population();
    let error = DetailedError {
        reason: FailureReason::BackfillWritesBusy,
        source: anyhow::anyhow!("busy"),
    };
    assert!(matches!(
        svc.defer(
            &msg,
            &error,
            u32::MAX - 1,
            Some(Duration::from_millis(70001))
        )
        .await
        .unwrap(),
        BackfillDeferral::Delete
    ));
    let state = f.0.lock().unwrap();
    assert_eq!(state.sent.len(), 1);
    assert_eq!(state.sent[0].0.backfill_operation, msg.backfill_operation);
    assert_eq!(state.sent[0].1, Some((71, u32::MAX)));
}

#[tokio::test]
async fn failed_deferral_retains_the_original_delivery() {
    let (svc, f) = setup();
    f.fail("defer");
    let error = DetailedError {
        reason: FailureReason::BackfillWritesBusy,
        source: anyhow::anyhow!("busy"),
    };
    assert!(matches!(
        svc.defer(&crm_population(), &error, 0, None).await.unwrap(),
        BackfillDeferral::LeaveForRedelivery
    ));
    assert!(f.0.lock().unwrap().sent.is_empty());
}

#[tokio::test]
async fn terminal_thread_and_message_failures_count_completion_but_tolerate_counter_failure() {
    let message = input(BackfillOperation::BackfillMessage(scope(
        BackfillMessagePayload {
            thread_provider_id: "thread".into(),
            thread_db_id: Uuid::from_u128(40),
            message_provider_id: "message".into(),
        },
    )));
    for (msg, count) in [
        (metadata(), "completed_thread"),
        (message, "completed_message"),
    ] {
        let (svc, f) = setup();
        f.fail(count);
        svc.terminal(
            &msg,
            &DetailedError {
                reason: FailureReason::InvalidData,
                source: anyhow::anyhow!("bad"),
            },
        )
        .await
        .unwrap();
        assert_eq!(f.calls(), ["link", count]);
    }
}

#[tokio::test]
async fn terminal_failure_with_a_lost_link_fails_and_notifies_the_job_in_order() {
    let (svc, f) = setup();
    f.fail("link");
    svc.terminal(
        &metadata(),
        &DetailedError {
            reason: FailureReason::InvalidData,
            source: anyhow::anyhow!("bad"),
        },
    )
    .await
    .unwrap();
    assert_eq!(f.calls(), ["link", "fail", "job", "link"]);
    let (svc, f) = setup();
    let msg = input(BackfillOperation::Init(scope(InitPayload {})));
    svc.terminal(
        &msg,
        &DetailedError {
            reason: FailureReason::InvalidData,
            source: anyhow::anyhow!("bad"),
        },
    )
    .await
    .unwrap();
    assert_eq!(f.calls(), ["fail", "job", "link", "notify"]);
    let (svc, f) = setup();
    f.0.lock().unwrap().failed_transition = false;
    svc.terminal(
        &msg,
        &DetailedError {
            reason: FailureReason::InvalidData,
            source: anyhow::anyhow!("bad"),
        },
    )
    .await
    .unwrap();
    assert_eq!(f.calls(), ["fail"]);
}

#[tokio::test]
async fn terminal_finalization_republishes_while_side_seeds_skip_accounting() {
    let error = DetailedError {
        reason: FailureReason::InvalidData,
        source: anyhow::anyhow!("bad"),
    };
    let (svc, f) = setup();
    svc.terminal(
        &input(BackfillOperation::FinalizeBackfill(scope(
            FinalizeBackfillPayload {},
        ))),
        &error,
    )
    .await
    .unwrap();
    assert_eq!(f.calls(), ["republish"]);
    for msg in [
        seed(),
        crm_population(),
        crm_depopulation(),
        population(),
        depopulation(),
    ] {
        let (svc, f) = setup();
        svc.terminal(&msg, &error).await.unwrap();
        assert!(f.calls().is_empty());
    }
}

#[tokio::test]
async fn initialization_and_finalization_respect_completed_lease_shortcuts() {
    let (svc, f) = setup();
    assert!(matches!(
        svc.process(&input(BackfillOperation::Init(scope(InitPayload {}))))
            .await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["job", "link", "init"]);
    let (svc, f) = setup();
    f.fail("job");
    assert!(matches!(
        svc.process(&input(BackfillOperation::FinalizeBackfill(scope(
            FinalizeBackfillPayload {}
        ))))
        .await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["finalize", "completion_pending"]);
}

#[tokio::test]
async fn terminal_accounting_failure_preserves_error_and_suppresses_notification() {
    let (svc, f) = setup();
    f.fail("fail");
    let e = svc
        .terminal(
            &input(BackfillOperation::Init(scope(InitPayload {}))),
            &DetailedError {
                reason: FailureReason::InvalidData,
                source: anyhow::anyhow!("bad"),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(e.to_string(), "fail");
    assert_eq!(f.calls(), ["fail"]);
}

#[tokio::test]
async fn failed_job_notifications_tolerate_missing_job_link_and_lookup_failure() {
    for fault in ["job_missing", "job_unlinked", "job", "link_missing", "link"] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            match fault {
                "job_missing" => s.job = None,
                "job_unlinked" => s.job.as_mut().unwrap().link_id = None,
                "link_missing" => s.link = None,
                _ => {
                    s.faults.insert(fault);
                }
            }
        }
        svc.terminal(
            &input(BackfillOperation::Init(scope(InitPayload {}))),
            &DetailedError {
                reason: FailureReason::InvalidData,
                source: anyhow::anyhow!("bad"),
            },
        )
        .await
        .unwrap();
        assert!(!f.calls().contains(&"notify"));
    }
}

#[tokio::test]
async fn noncontention_crm_population_error_keeps_normal_retry_policy_and_releases_the_slot() {
    let (svc, f) = setup();
    f.fail("populate");
    f.0.lock().unwrap().crm_contended = false;
    let error = failure(
        svc.process(&crm_population()).await,
        true,
        FailureReason::DatabaseQueryFailed,
    );
    assert_eq!(
        format!("{:#}", error.source),
        "Failed to populate CRM contact: provider failure"
    );
    assert_eq!(
        f.calls(),
        ["link", "team", "acquire", "hold", "populate", "release"]
    );
}

#[tokio::test]
async fn committed_metadata_does_not_retry_a_failed_broker_publication() {
    let (svc, fake) = setup();
    fake.fail("event");
    assert!(matches!(
        svc.process(&metadata()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        fake.calls(),
        [
            "job",
            "link",
            "begin",
            "metadata",
            "replying_to",
            "commit",
            "completed_thread",
            "event"
        ]
    );
}
