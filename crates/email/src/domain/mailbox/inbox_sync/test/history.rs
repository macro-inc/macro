use super::{
    fakes::{Call, LINK, input, make_service},
    import_fakes::job,
    *,
};
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
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

#[tokio::test]
async fn missing_history_and_query_failure_keep_the_original_dispositions() {
    for missing in [false, true] {
        let (svc, fake) = make_service(false);
        if missing {
            fake.0.lock().unwrap().import.history = None;
        } else {
            fake.0.lock().unwrap().failures.push(("history", 1));
        }
        let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
        assert_eq!(delete, missing);
        assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
        assert!(error.source.to_string().starts_with("gmail_message:"));
        assert_eq!(names(&fake.calls()), vec!["history"]);
    }
}
#[tokio::test]
async fn equal_or_newer_history_skips_every_provider_and_journal_call() {
    for cursor in ["42", "100"] {
        let (svc, fake) = make_service(false);
        fake.0.lock().unwrap().import.history = Some(cursor.into());
        assert!(matches!(
            svc.process(Ok(input(gmail_notification()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        assert_eq!(names(&fake.calls()), vec!["history"]);
    }
}
#[tokio::test]
async fn incremental_history_reconciles_catalog_before_reading_and_accepting_changes() {
    let (svc, fake) = make_service(false);
    fake.0.lock().unwrap().import.history = Some("1".into());
    assert!(matches!(
        svc.process(Ok(input(gmail_notification()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    assert_eq!(
        names(&fake.calls()),
        vec![
            "history",
            "provider_catalog",
            "catalog",
            "changes",
            "accept"
        ]
    );
}
#[tokio::test]
async fn malformed_history_creates_or_reuses_a_recovery_job_then_repairs_the_cursor() {
    for reuse in [false, true] {
        let (svc, fake) = make_service(false);
        {
            let mut s = fake.0.lock().unwrap();
            s.import.history = Some("invalid".into());
            if reuse {
                s.import.jobs.push_back(Some(job()));
            }
        }
        let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
        assert!(delete);
        assert_eq!(error.reason, FailureReason::OutdatedHistoryId);
        assert!(
            error
                .source
                .to_string()
                .contains("Failed to parse current history_id as u64")
        );
        let expected = if reuse {
            vec!["history", "active_job", "backfill_queue", "repair"]
        } else {
            vec![
                "history",
                "active_job",
                "insert_job",
                "backfill_queue",
                "repair",
            ]
        };
        assert_eq!(names(&fake.calls()), expected);
        let body = fake
            .calls()
            .into_iter()
            .find_map(|c| {
                if let Call::Import("backfill_queue", v) = c {
                    Some(v)
                } else {
                    None
                }
            })
            .unwrap();
        assert!(body.to_string().contains(&LINK.to_string()));
    }
}
#[tokio::test]
async fn recovery_insert_conflict_reads_the_winner_and_missing_winner_is_retryable() {
    for missing in [false, true] {
        let (svc, fake) = make_service(false);
        {
            let mut s = fake.0.lock().unwrap();
            s.import.history = Some("bad".into());
            s.import.insert_job = None;
            s.import
                .jobs
                .extend([None, if missing { None } else { Some(job()) }]);
        }
        let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
        assert_eq!(delete, !missing);
        if missing {
            assert_eq!(
                error.source.to_string(),
                "gmail_message: Failed to schedule stale-cursor backfill"
            );
        }
        assert_eq!(
            names(&fake.calls())
                .iter()
                .filter(|n| **n == "active_job")
                .count(),
            2
        );
    }
}
#[tokio::test]
async fn recovery_enqueue_failure_only_fails_new_jobs_and_cleanup_failure_masks_it() {
    for reuse in [false, true] {
        for cleanup_failure in [false, true] {
            let (svc, fake) = make_service(false);
            {
                let mut s = fake.0.lock().unwrap();
                s.import.history = Some("bad".into());
                if reuse {
                    s.import.jobs.push_back(Some(job()));
                }
                s.failures.push(("backfill_queue", 1));
                if cleanup_failure {
                    s.failures.push(("fail_job", 1));
                }
            }
            let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
            assert!(!delete);
            assert_eq!(
                error.reason,
                if !reuse && cleanup_failure {
                    FailureReason::DatabaseQueryFailed
                } else {
                    FailureReason::SqsEnqueueFailed
                }
            );
            let calls = names(&fake.calls());
            assert_eq!(calls.contains(&"fail_job"), !reuse);
            assert!(!calls.contains(&"repair"));
        }
    }
}
#[tokio::test]
async fn a_failed_cursor_repair_remains_best_effort_after_publication() {
    let (svc, fake) = make_service(false);
    {
        let mut s = fake.0.lock().unwrap();
        s.import.history = Some("bad".into());
        s.failures.push(("repair", 1));
    }
    let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
    assert!(delete);
    assert_eq!(error.reason, FailureReason::OutdatedHistoryId);
}
#[tokio::test]
async fn catalog_and_change_provider_failures_keep_their_queue_policy() {
    for retry in [false, true] {
        for changes in [false, true] {
            for error in [
                EmailApiError::Forbidden,
                EmailApiError::AuthRequired,
                EmailApiError::RateLimited {
                    retry_after: None,
                    origin: RateLimitOrigin::Local,
                },
            ] {
                let rate = matches!(error, EmailApiError::RateLimited { .. });
                let (svc, fake) = make_service(retry);
                {
                    let mut s = fake.0.lock().unwrap();
                    s.import.history = Some("1".into());
                    if changes {
                        s.import.changes = Err(error)
                    } else {
                        s.import.provider_catalog = Err(error)
                    }
                }
                let (delete, _) = failure(svc.process(Ok(input(gmail_notification()))).await);
                assert_eq!(
                    fake.calls()
                        .iter()
                        .any(|c| matches!(c, Call::Enqueue(true, _))),
                    rate && !retry
                );
                if rate {
                    assert_eq!(delete, !retry);
                }
            }
        }
    }
}
#[tokio::test]
async fn expired_provider_cursor_schedules_recovery_before_its_terminal_error() {
    let (svc, fake) = make_service(false);
    {
        let mut s = fake.0.lock().unwrap();
        s.import.history = Some("1".into());
        s.import.changes = Err(EmailApiError::OutdatedCursor);
    }
    let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
    assert!(delete);
    assert_eq!(error.reason, FailureReason::OutdatedHistoryId);
    assert_eq!(
        names(&fake.calls()),
        vec![
            "history",
            "provider_catalog",
            "catalog",
            "changes",
            "active_job",
            "insert_job",
            "backfill_queue",
            "repair"
        ]
    );
}
#[tokio::test]
async fn history_query_and_journal_failures_stop_later_steps() {
    for step in ["catalog", "accept", "active_job", "insert_job"] {
        let (svc, fake) = make_service(false);
        {
            let mut s = fake.0.lock().unwrap();
            s.import.history = Some(
                if step == "active_job" || step == "insert_job" {
                    "bad"
                } else {
                    "1"
                }
                .into(),
            );
            s.failures.push((step, 1));
        }
        let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
        assert!(!delete);
        assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
        assert_eq!(names(&fake.calls()).last(), Some(&step));
    }
}

#[tokio::test]
async fn catalog_diff_deletes_missing_then_upserts_changed_and_new_labels() {
    let (svc, fake) = make_service(false);
    {
        let mut s = fake.0.lock().unwrap();
        s.import.history = Some("1".into());
        let mut old: models_email::service::label::Label = super::fakes::label("keep").into();
        old.name = Some("old".into());
        let mut changed = old.clone();
        changed.name = Some("new".into());
        s.import.catalog = vec![old, super::fakes::label("gone").into()];
        s.import.provider_catalog = Ok(vec![changed, super::fakes::label("added").into()]);
    }
    assert!(matches!(
        svc.process(Ok(input(gmail_notification()))).await,
        InboxSyncDisposition::DoneDelete
    ));
    let calls = fake.calls();
    let delete = calls
        .iter()
        .position(|c| matches!(c, Call::Import("delete_catalog", _)))
        .unwrap();
    let upsert = calls
        .iter()
        .position(|c| matches!(c, Call::Import("upsert_catalog", _)))
        .unwrap();
    assert!(delete < upsert);
    let Call::Import(_, ref labels) = calls[upsert] else {
        unreachable!()
    };
    assert_eq!(labels.as_array().unwrap().len(), 2);
}
#[tokio::test]
async fn catalog_writes_fail_before_the_changes_fetch() {
    for step in ["delete_catalog", "upsert_catalog"] {
        let (svc, fake) = make_service(false);
        {
            let mut s = fake.0.lock().unwrap();
            s.import.history = Some("1".into());
            s.import.catalog = vec![super::fakes::label("gone").into()];
            s.import.provider_catalog = Ok(vec![super::fakes::label("added").into()]);
            s.failures.push((step, 1));
        }
        let (delete, error) = failure(svc.process(Ok(input(gmail_notification()))).await);
        assert!(!delete);
        assert_eq!(error.reason, FailureReason::DatabaseQueryFailed);
        assert!(!names(&fake.calls()).contains(&"changes"));
    }
}

#[tokio::test]
async fn catalog_compares_each_provider_field_and_retains_the_stored_identity() {
    for field in 0..5 {
        let (svc, fake) = make_service(false);
        {
            let mut s = fake.0.lock().unwrap();
            s.import.history = Some("1".into());
            let old: models_email::service::label::Label = super::fakes::label("same").into();
            let mut new = old.clone();
            new.id = None;
            match field {
                0 => new.name = Some("renamed".into()),
                1 => new.message_list_visibility = None,
                2 => new.label_list_visibility = None,
                3 => new.type_ = None,
                _ => {}
            }
            s.import.catalog = vec![old];
            s.import.provider_catalog = Ok(vec![new]);
        }
        assert!(matches!(
            svc.process(Ok(input(gmail_notification()))).await,
            InboxSyncDisposition::DoneDelete
        ));
        let calls = fake.calls();
        let labels = calls.iter().find_map(|c| {
            if let Call::Import("upsert_catalog", v) = c {
                Some(v)
            } else {
                None
            }
        });
        assert_eq!(labels.is_some(), field != 4);
        if let Some(labels) = labels {
            assert_eq!(labels[0]["id"], Uuid::from_u128(5).to_string());
        }
    }
}
