use super::*;
use crate::backfill::job::update::{BackfillCompletion, complete_backfill_job};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn insert_job(pool: &PgPool, completed_threads: Option<i32>) -> Uuid {
    let job_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_backfill_jobs (id, fusionauth_user_id, status, total_threads, completed_threads) VALUES ($1, 'fa-backfill-progress', 'InProgress', 2000, $2)",
        job_id, completed_threads
    ).execute(pool).await.unwrap();
    job_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_and_missing_progress_never_mean_complete(pool: PgPool) {
    let legacy = insert_job(&pool, None).await;
    assert!(!is_tracked(&pool, legacy).await.unwrap());
    assert!(
        complete_thread(&pool, legacy, "stored-message-thread")
            .await
            .is_err()
    );
    assert_eq!(
        complete_backfill_job(&pool, legacy, None).await.unwrap(),
        BackfillCompletion::NotReady
    );
    let tracked = insert_job(&pool, Some(0)).await;
    assert!(thread_completed(&pool, tracked, "unknown").await.is_err());
    assert!(complete_thread(&pool, tracked, "unknown").await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duplicate_pages_and_priority_overlap_count_unique_work(pool: PgPool) {
    let job = insert_job(&pool, Some(0)).await;
    register_page(
        &pool,
        job,
        true,
        "",
        ListingPage {
            thread_provider_ids: vec!["a".into()],
            next_page_token: None,
        },
    )
    .await
    .unwrap();
    let (a, b) = tokio::join!(
        register_page(
            &pool,
            job,
            false,
            "",
            ListingPage {
                thread_provider_ids: vec!["a".into(), "b".into()],
                next_page_token: Some("page-2".into()),
            }
        ),
        register_page(
            &pool,
            job,
            false,
            "",
            ListingPage {
                thread_provider_ids: vec!["a".into(), "b".into()],
                next_page_token: Some("page-2".into()),
            }
        ),
    );
    assert_eq!(a.unwrap(), b.unwrap());
    let saved = register_page(
        &pool,
        job,
        false,
        "",
        ListingPage {
            thread_provider_ids: vec!["different-provider-answer".into()],
            next_page_token: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(saved.thread_provider_ids, ["a", "b"]);
    assert_eq!(saved.next_page_token.as_deref(), Some("page-2"));
    sqlx::query!(
        "UPDATE email_backfill_thread_progress SET thread_id = $2 WHERE backfill_job_id = $1",
        job,
        Uuid::now_v7()
    )
    .execute(&pool)
    .await
    .unwrap();
    let progress = complete_thread(&pool, job, "a").await.unwrap();
    assert_eq!(progress.total_threads, 2);
    assert_eq!(progress.completed_threads, 1);
    assert!(!progress.listing_complete);
    let retrieved = sqlx::query_scalar!(
        "SELECT threads_retrieved_count FROM email_backfill_jobs WHERE id = $1",
        job
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(retrieved, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn redelivery_and_concurrent_completion_cannot_finish_early(pool: PgPool) {
    let job = insert_job(&pool, Some(0)).await;
    register_page(
        &pool,
        job,
        false,
        "",
        ListingPage {
            thread_provider_ids: vec!["a".into(), "b".into()],
            next_page_token: None,
        },
    )
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_backfill_thread_progress SET thread_id = $2 WHERE backfill_job_id = $1",
        job,
        Uuid::now_v7()
    )
    .execute(&pool)
    .await
    .unwrap();
    let (first, duplicate) = tokio::join!(
        complete_thread(&pool, job, "a"),
        complete_thread(&pool, job, "a")
    );
    assert_eq!(first.unwrap().completed_threads, 1);
    assert_eq!(duplicate.unwrap().completed_threads, 1);
    finish_listing(&pool, job).await.unwrap();
    assert_eq!(
        complete_backfill_job(&pool, job, None).await.unwrap(),
        BackfillCompletion::NotReady
    );
    // A crash after the last receipt but before the job/outbox transaction is
    // recoverable by the same delivery, without counting it twice.
    complete_thread(&pool, job, "b").await.unwrap();
    let replay = complete_thread(&pool, job, "b").await.unwrap();
    assert_eq!(replay.completed_threads, 2);
    let (first, duplicate) = tokio::join!(
        complete_backfill_job(&pool, job, None),
        complete_backfill_job(&pool, job, None)
    );
    assert!(matches!(
        (first.unwrap(), duplicate.unwrap()),
        (
            BackfillCompletion::Completed,
            BackfillCompletion::AlreadyTerminal
        ) | (
            BackfillCompletion::AlreadyTerminal,
            BackfillCompletion::Completed
        )
    ));
    let outboxes = sqlx::query_scalar!(
        "SELECT count(*) FROM email_backfill_completion_outbox WHERE backfill_job_id = $1",
        job
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(outboxes, Some(1));
    assert!(thread_completed(&pool, job, "a").await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn listing_barrier_and_empty_mailbox_use_actual_work(pool: PgPool) {
    let job = insert_job(&pool, Some(0)).await;
    register_page(
        &pool,
        job,
        false,
        "",
        ListingPage {
            thread_provider_ids: vec![],
            next_page_token: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        complete_backfill_job(&pool, job, None).await.unwrap(),
        BackfillCompletion::NotReady
    );
    finish_listing(&pool, job).await.unwrap();
    assert_eq!(
        complete_backfill_job(&pool, job, None).await.unwrap(),
        BackfillCompletion::Completed
    );
    let total = sqlx::query_scalar!(
        "SELECT total_threads FROM email_backfill_jobs WHERE id = $1",
        job
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(total, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancellation_cannot_be_undone_by_inflight_completion(pool: PgPool) {
    let job = insert_job(&pool, Some(0)).await;
    register_page(
        &pool,
        job,
        false,
        "",
        ListingPage {
            thread_provider_ids: vec!["a".into()],
            next_page_token: None,
        },
    )
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_backfill_thread_progress SET thread_id = $2 WHERE backfill_job_id = $1",
        job,
        Uuid::now_v7()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_backfill_jobs SET status = 'Cancelled' WHERE id = $1",
        job
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        complete_thread(&pool, job, "a")
            .await
            .unwrap()
            .completed_threads,
        0
    );
    assert!(!complete_thread(&pool, job, "a").await.unwrap().active);
    assert!(!thread_completed(&pool, job, "a").await.unwrap());
    assert_eq!(
        complete_backfill_job(&pool, job, None).await.unwrap(),
        BackfillCompletion::AlreadyTerminal
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_provider_thread_is_counted_once_without_skipping_other_work(pool: PgPool) {
    let job = insert_job(&pool, Some(0)).await;
    register_page(
        &pool,
        job,
        false,
        "",
        ListingPage {
            thread_provider_ids: vec!["gone".into(), "present".into()],
            next_page_token: None,
        },
    )
    .await
    .unwrap();
    finish_listing(&pool, job).await.unwrap();
    let missing = import::mark_provider_missing(&pool, job, "gone")
        .await
        .unwrap();
    assert!(missing.provider_missing);
    assert_eq!(missing.thread_id, None);
    let (a, b) = tokio::join!(
        complete_thread(&pool, job, "gone"),
        complete_thread(&pool, job, "gone")
    );
    assert_eq!(a.unwrap().completed_threads, 1);
    assert_eq!(b.unwrap().completed_threads, 1);
    assert_eq!(
        complete_backfill_job(&pool, job, None).await.unwrap(),
        BackfillCompletion::NotReady
    );
    let thread = Uuid::now_v7();
    sqlx::query!("UPDATE email_backfill_thread_progress SET thread_id = $3 WHERE backfill_job_id = $1 AND thread_provider_id = $2", job, "present", thread).execute(&pool).await.unwrap();
    // A later provider 404 cannot discard a snapshot already committed by a
    // concurrent successful import; that snapshot still needs its effects.
    let imported = import::mark_provider_missing(&pool, job, "present")
        .await
        .unwrap();
    assert_eq!(imported.thread_id, Some(thread));
    assert!(!imported.provider_missing);
    assert!(!imported.completed);
    complete_thread(&pool, job, "present").await.unwrap();
    assert_eq!(
        complete_backfill_job(&pool, job, None).await.unwrap(),
        BackfillCompletion::Completed
    );
}
