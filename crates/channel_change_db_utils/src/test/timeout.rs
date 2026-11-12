//! Counter waits are bounded without changing the caller's other statements.

use super::*;
use sqlx::Acquire;
use std::time::{Duration as StdDuration, Instant};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn append_restores_lock_timeout_and_preserves_statement_timeout(pool: PgPool) {
    let mut connection = pool.acquire().await.unwrap();
    sqlx::query!("SET statement_timeout = '500ms'")
        .execute(&mut *connection)
        .await
        .unwrap();
    for previous in ["0", "10ms", "10s"] {
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
            assert_eq!(
                sqlx::query_scalar!("SELECT current_setting('statement_timeout') AS \"timeout!\"")
                    .fetch_one(&mut *tx)
                    .await
                    .unwrap(),
                "500ms"
            );
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
        sqlx::query!("SET LOCAL lock_timeout = '25ms'")
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
async fn a_later_statement_keeps_the_callers_longer_statement_timeout(pool: PgPool) {
    let other = Uuid::new_v4();
    let mut setup = pool.begin().await.unwrap();
    append_in(&mut setup, other, Change::Reset).await.unwrap();
    setup.commit().await.unwrap();
    for batch in [false, true] {
        let mut holder = pool.begin().await.unwrap();
        append_in(&mut holder, other, Change::Reset).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query!("SET LOCAL statement_timeout = '500ms'")
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batch_guard_does_not_impose_a_statement_deadline(pool: PgPool) {
    let channels = [1, 2, 3, 4].map(Uuid::from_u128);
    let mut seed = pool.begin().await.unwrap();
    for channel in channels {
        append_in(&mut seed, channel, Change::Reset).await.unwrap();
    }
    seed.commit().await.unwrap();
    let mut holders = Vec::new();
    for channel in channels {
        let mut holder = pool.begin().await.unwrap();
        append_in(&mut holder, channel, Change::Reset)
            .await
            .unwrap();
        holders.push(holder);
    }
    // The stalled-holder guard does not impose a total statement deadline.
    // Multiple short waits may cumulatively exceed50ms and still succeed.
    let mut tx = pool.begin().await.unwrap();
    let started = Instant::now();
    let release = tokio::spawn(async move {
        let mut releases = Vec::new();
        for holder in holders {
            tokio::time::sleep(StdDuration::from_millis(25)).await;
            holder.rollback().await.unwrap();
            releases.push(Instant::now());
        }
        releases
    });
    let receipts = append_activities_in(&mut tx, &channels, &channels.map(|_| Uuid::new_v4()))
        .await
        .expect("the lock guard must allow successive short waits");
    assert_eq!(receipts.len(), 4);
    assert!(started.elapsed() >= StdDuration::from_millis(75));
    tx.commit().await.unwrap();
    release.await.unwrap();
    for channel in channels {
        assert_eq!(current_seq(&pool, channel).await.unwrap(), 2);
    }
}
