use crate::outbound::backfill_jobs::{
    PgBackfillJobs,
    worker::{BackfillWorkerEffects, PgBackfillWorker},
};
use crate::pubsub::label_write_sim::world::World;
use email::domain::backfill_jobs::worker::{BackfillEffects, BackfillRepository};
use redis::AsyncCommands;
use sqlx::PgPool;
use std::collections::BTreeMap;
use uuid::Uuid;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_thread_progress_removes_only_the_requested_redis_progress(pool: PgPool) {
    let world = World::new(pool, 98_001, false).await;
    let effects = BackfillWorkerEffects(world.sync.backfill_context());
    let job = Uuid::now_v7();
    let other_job = Uuid::now_v7();
    let target = format!("bf_thread_status:{job}:target");
    let other_thread = format!("bf_thread_status:{job}:other");
    let other_job_thread = format!("bf_thread_status:{other_job}:target");
    let job_key = format!("bf_job_status:{job}");
    let mut redis = world.redis.clone();
    for key in [&target, &other_thread, &other_job_thread] {
        let _: () = redis
            .hset_multiple(key, &[("completed_messages", 1), ("total_messages", 3)])
            .await
            .unwrap();
        let _: bool = redis.expire(key, 60).await.unwrap();
    }
    effects
        .0
        .redis_client
        .init_backfill_job_progress(job, 4)
        .await
        .unwrap();
    let _: bool = redis.expire(&job_key, 60).await.unwrap();
    let untouched = [&other_thread, &other_job_thread, &job_key];
    let mut before = Vec::new();
    for key in untouched {
        before.push(
            redis
                .hgetall::<_, BTreeMap<String, i32>>(key)
                .await
                .unwrap(),
        );
    }
    assert!(redis.exists::<_, bool>(&target).await.unwrap());

    effects.delete_thread_progress(job, "target").await;

    assert!(!redis.exists::<_, bool>(&target).await.unwrap());
    for (key, expected) in untouched.into_iter().zip(&before) {
        assert_eq!(
            &redis
                .hgetall::<_, BTreeMap<String, i32>>(key)
                .await
                .unwrap(),
            expected
        );
    }
    effects.delete_thread_progress(job, "target").await;
    assert!(!redis.exists::<_, bool>(&target).await.unwrap());
    let _: () = redis
        .del(&[&other_thread, &other_job_thread, &job_key])
        .await
        .unwrap();
}

#[derive(Clone, Debug, PartialEq)]
struct CompletionRow {
    id: Uuid,
    backfill_job_id: Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
    published_at: Option<chrono::DateTime<chrono::Utc>>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
    effects_lease_token: Option<Uuid>,
    effects_lease_expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn completion_rows(pool: &PgPool) -> Vec<CompletionRow> {
    sqlx::query_as!(
        CompletionRow,
        "SELECT id, backfill_job_id, created_at, published_at, completed_at,
                effects_lease_token, effects_lease_expires_at
         FROM email_backfill_completion_outbox ORDER BY id"
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn republish_completion_marks_only_the_existing_job_outbox_pending(pool: PgPool) {
    let job = Uuid::now_v7();
    let other_job = Uuid::now_v7();
    let outbox = Uuid::now_v7();
    let other_outbox = Uuid::now_v7();
    let lease = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_backfill_jobs (id, fusionauth_user_id, status)
         VALUES ($1, 'test-owner', 'Complete'), ($2, 'test-other-owner', 'Complete')",
        job,
        other_job
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_backfill_completion_outbox
            (id, backfill_job_id, published_at, effects_lease_token, effects_lease_expires_at)
         VALUES ($1, $2, '2026-01-01T00:00:00Z', $5, '2026-01-01T00:05:00Z'),
                ($3, $4, '2026-01-02T00:00:00Z', NULL, NULL)",
        outbox,
        job,
        other_outbox,
        other_job,
        lease
    )
    .execute(&pool)
    .await
    .unwrap();
    let before = completion_rows(&pool).await;
    assert_eq!(before.len(), 2);
    assert!(before.iter().all(|row| row.published_at.is_some()));
    let repository = PgBackfillWorker {
        jobs: PgBackfillJobs(pool.clone()),
    };

    repository.republish_completion(job).await;

    let mut expected = before;
    expected
        .iter_mut()
        .find(|row| row.backfill_job_id == job)
        .unwrap()
        .published_at = None;
    assert_eq!(completion_rows(&pool).await, expected);

    repository.republish_completion(job).await;
    repository.republish_completion(Uuid::now_v7()).await;
    assert_eq!(completion_rows(&pool).await, expected);
}
