use super::*;
use chrono::Utc;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::email::service::link::UserProvider;
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::time::Duration;

fn backfill_job(job_id: Uuid) -> BackfillJob {
    BackfillJob {
        id: job_id,
        link_id: Some(Uuid::new_v4()),
        fusionauth_user_id: "fusion-user".to_owned(),
        threads_requested_limit: None,
        total_threads: 10,
        status: BackfillJobStatus::InProgress,
        threads_retrieved_count: 10,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn link(link_id: Uuid) -> link::Link {
    link::Link {
        id: link_id,
        macro_id: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
        fusionauth_user_id: "fusion-user".to_owned(),
        email_address: EmailStr::try_from("inbox@example.com".to_owned()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: false,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[tokio::test]
async fn throttled_message_stops_before_context_and_gmail_work() {
    let job_fetch_started = Cell::new(false);
    let link_fetch_started = Cell::new(false);
    let token_fetch_started = Cell::new(false);
    let gmail_message_fetch_started = Cell::new(false);

    let result = dispatch_backfill_message(
        async {
            Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiRateLimited,
                source: anyhow::anyhow!("Gmail API rate limit exceeded"),
            }))
        },
        async {
            job_fetch_started.set(true);
            link_fetch_started.set(true);
            token_fetch_started.set(true);
            gmail_message_fetch_started.set(true);
            Ok(())
        },
    )
    .await;

    assert!(matches!(
        result,
        Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            ..
        }))
    ));
    assert!(!job_fetch_started.get());
    assert!(!link_fetch_started.get());
    assert!(!token_fetch_started.get());
    assert!(!gmail_message_fetch_started.get());
}

#[tokio::test]
async fn job_and_link_loaders_reuse_positive_cache_entries() {
    let job_id = Uuid::new_v4();
    let link_id = Uuid::new_v4();
    let jobs = TtlCache::new(10, Duration::from_secs(60));
    let links = TtlCache::new(10, Duration::from_secs(60));
    let job_loads = AtomicUsize::new(0);
    let link_loads = AtomicUsize::new(0);

    for _ in 0..2 {
        let loaded_job = load_backfill_job(&jobs, job_id, || async {
            job_loads.fetch_add(1, Ordering::SeqCst);
            Ok(Some(backfill_job(job_id)))
        })
        .await
        .unwrap();
        let loaded_link = load_link(&links, link_id, || async {
            link_loads.fetch_add(1, Ordering::SeqCst);
            Ok(Some(link(link_id)))
        })
        .await
        .unwrap();

        assert_eq!(loaded_job.id, job_id);
        assert_eq!(loaded_link.id, link_id);
    }

    assert_eq!(job_loads.load(Ordering::SeqCst), 1);
    assert_eq!(link_loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn job_loader_refreshes_after_expiration() {
    let job_id = Uuid::new_v4();
    let jobs = TtlCache::new(10, Duration::from_millis(10));

    load_backfill_job(&jobs, job_id, || async { Ok(Some(backfill_job(job_id))) })
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    let refreshed = load_backfill_job(&jobs, job_id, || async {
        let mut job = backfill_job(job_id);
        job.status = BackfillJobStatus::Complete;
        Ok(Some(job))
    })
    .await
    .unwrap();

    assert_eq!(refreshed.status, BackfillJobStatus::Complete);
}
