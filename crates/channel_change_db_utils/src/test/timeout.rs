//! Counter waits are bounded without changing the caller's other statements.

use super::*;
use sqlx::Acquire;
use std::time::{Duration as StdDuration, Instant};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn append_restores_stricter_disabled_and_longer_timeouts(pool: PgPool) {
    let mut connection = pool.acquire().await.unwrap();
    for previous in ["0", "1ms", "2s"] {
        sqlx::query!("SELECT set_config('lock_timeout', $1, false)", previous)
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        for batch in [false, true] {
            let mut tx = connection.begin().await.unwrap();
            let channel = Uuid::new_v4();
            if batch {
                append_activities_in(
                    &mut tx,
                    &[channel, channel],
                    &[Uuid::new_v4(), Uuid::new_v4()],
                )
                .await
                .unwrap();
            } else {
                append_in(&mut tx, channel, Change::Reset).await.unwrap();
            }
            let restored =
                sqlx::query_scalar!("SELECT current_setting('lock_timeout') AS \"timeout!\"")
                    .fetch_one(&mut *tx)
                    .await
                    .unwrap();
            assert_eq!(restored, previous);
            tx.commit().await.unwrap();
            let after_commit =
                sqlx::query_scalar!("SELECT current_setting('lock_timeout') AS \"timeout!\"")
                    .fetch_one(&mut *connection)
                    .await
                    .unwrap();
            assert_eq!(after_commit, previous);
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn counter_timeout_rolls_back_prior_and_partial_batch_changes(pool: PgPool) {
    let held = Uuid::from_u128(2);
    let free = Uuid::from_u128(1);
    let prior = Uuid::from_u128(3);
    let mut holder = pool.begin().await.unwrap();
    append_in(&mut holder, held, Change::Reset).await.unwrap();

    for batch in [false, true] {
        let mut waiter = pool.begin().await.unwrap();
        sqlx::query!("SET LOCAL lock_timeout = '0'")
            .execute(&mut *waiter)
            .await
            .unwrap();
        append_in(&mut waiter, prior, Change::Reset).await.unwrap();
        let started = Instant::now();
        let failure = tokio::time::timeout(StdDuration::from_secs(3), async {
            if batch {
                append_activities_in(
                    &mut waiter,
                    &[free, held],
                    &[Uuid::new_v4(), Uuid::new_v4()],
                )
                .await
                .map(|_| ())
            } else {
                append_in(&mut waiter, held, Change::Reset)
                    .await
                    .map(|_| ())
            }
        })
        .await
        .expect("the counter wait must have a database deadline")
        .unwrap_err();
        assert_eq!(
            failure.as_database_error().unwrap().code().as_deref(),
            Some("55P03")
        );
        assert!(started.elapsed() < StdDuration::from_secs(1));
        let aborted = sqlx::query_scalar!("SELECT 1 AS \"one!\"")
            .fetch_one(&mut *waiter)
            .await
            .unwrap_err();
        assert_eq!(
            aborted.as_database_error().unwrap().code().as_deref(),
            Some("25P02")
        );
        waiter.rollback().await.unwrap();
        assert_eq!(current_seq(&pool, prior).await.unwrap(), 0);
        assert_eq!(current_seq(&pool, free).await.unwrap(), 0);
        assert_eq!(current_seq(&pool, held).await.unwrap(), 0);
    }
    holder.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(append_in(&mut tx, held, Change::Reset).await.unwrap(), 1);
    tx.commit().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_later_statement_keeps_the_callers_longer_lock_timeout(pool: PgPool) {
    let other = Uuid::new_v4();
    let mut setup = pool.begin().await.unwrap();
    append_in(&mut setup, other, Change::Reset).await.unwrap();
    setup.commit().await.unwrap();
    for batch in [false, true] {
        let mut holder = pool.begin().await.unwrap();
        append_in(&mut holder, other, Change::Reset).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query!("SET LOCAL lock_timeout = '500ms'")
            .execute(&mut *tx)
            .await
            .unwrap();
        if batch {
            append_activities_in(&mut tx, &[Uuid::new_v4()], &[Uuid::new_v4()])
                .await
                .unwrap();
        } else {
            append_in(&mut tx, Uuid::new_v4(), Change::Reset)
                .await
                .unwrap();
        }
        let release = tokio::spawn(async move {
            tokio::time::sleep(StdDuration::from_millis(75)).await;
            holder.rollback().await.unwrap();
        });
        let started = Instant::now();
        sqlx::query!(
            "UPDATE channel_change_counters SET updated_at = now() WHERE channel_id = $1",
            other
        )
        .execute(&mut *tx)
        .await
        .expect("a later statement must retain the caller's 500ms limit");
        assert!(started.elapsed() >= StdDuration::from_millis(50));
        release.await.unwrap();
        tx.commit().await.unwrap();
    }
}
