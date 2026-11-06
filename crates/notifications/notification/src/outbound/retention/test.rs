use super::*;
use crate::domain::models::NotificationState;
use chrono::TimeDelta;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::postgres::PgListener;
use std::collections::HashSet;
use uuid::Uuid;

fn cutoff() -> NaiveDateTime {
    DateTime::parse_from_rfc3339("2026-09-15T12:00:00Z")
        .unwrap()
        .naive_utc()
}

fn limit(n: u16) -> NonZeroU16 {
    NonZeroU16::new(n).unwrap()
}

async fn insert(pool: &PgPool, created_at: NaiveDateTime) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, created_at)
         VALUES ($1, 'test', 'retention-document', 'document', 'retention-test', $2)",
        id, created_at,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn remaining(pool: &PgPool) -> Vec<Uuid> {
    sqlx::query_scalar!("SELECT id FROM notification ORDER BY created_at, id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn boundary_is_strict_and_preview_is_read_only_and_bounded(pool: PgPool) {
    let old = insert(&pool, cutoff() - TimeDelta::days(1)).await;
    let just_old = insert(&pool, cutoff() - TimeDelta::microseconds(1)).await;
    let boundary = insert(&pool, cutoff()).await;
    let fresh = insert(&pool, cutoff() + TimeDelta::microseconds(1)).await;
    let repo = PgNotificationRetentionRepository::new(pool.clone());
    let preview = repo.preview(cutoff(), limit(1)).await.unwrap();
    assert_eq!(preview.sampled_expired, 1);
    assert_eq!(
        preview.oldest_expired_at,
        Some(cutoff() - TimeDelta::days(1))
    );
    assert_eq!(remaining(&pool).await, [old, just_old, boundary, fresh]);
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::Deleted(2)
    );
    assert_eq!(remaining(&pool).await, [boundary, fresh]);
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::Deleted(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bounded_oldest_first_batches_resume_on_retry(pool: PgPool) {
    let later = insert(&pool, cutoff() - TimeDelta::seconds(1)).await;
    let oldest_a = insert(&pool, cutoff() - TimeDelta::days(2)).await;
    let oldest_b = insert(&pool, cutoff() - TimeDelta::days(2)).await;
    let repo = PgNotificationRetentionRepository::new(pool.clone());
    assert_eq!(
        repo.delete_batch(cutoff(), limit(1)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
    assert_eq!(remaining(&pool).await, [oldest_a.max(oldest_b), later]);
    assert_eq!(
        repo.delete_batch(cutoff(), limit(1)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
    assert_eq!(remaining(&pool).await, [later]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn parent_age_controls_all_states_and_cascades_to_receipts(pool: PgPool) {
    let old = insert(&pool, cutoff() - TimeDelta::days(1)).await;
    let fresh = insert(&pool, cutoff() + TimeDelta::days(1)).await;
    for (i, state) in [
        NotificationState::Unseen,
        NotificationState::Seen,
        NotificationState::Done,
    ]
    .into_iter()
    .enumerate()
    {
        let user = format!("macro|retention-{i}@test.com");
        for notification in [old, fresh] {
            // A fresh recipient on an expired parent must expire; an old
            // recipient on a fresh parent must survive. Include soft deletes.
            let child_created = if notification == old {
                cutoff() + TimeDelta::days(1)
            } else {
                cutoff() - TimeDelta::days(1)
            };
            let deleted_at = (i == 2).then_some(child_created);
            sqlx::query!(
                "INSERT INTO user_notification (user_id, notification_id, created_at, state, deleted_at)
                 VALUES ($1, $2, $3, $4, $5)",
                user, notification, child_created, state as NotificationState, deleted_at,
            ).execute(&pool).await.unwrap();
            let message = format!("{notification}-{i}");
            sqlx::query!(
                "INSERT INTO notification_message_receipt (message_id, user_id, notification_id) VALUES ($1, $2, $3)",
                message, user, notification,
            ).execute(&pool).await.unwrap();
        }
    }
    // Settings with similar names are not notification history.
    sqlx::query!(
        "INSERT INTO user_mute_notification (user_id) VALUES ('macro|retention-0@test.com')"
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgNotificationRetentionRepository::new(pool.clone());
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
    assert_eq!(remaining(&pool).await, [fresh]);
    assert_eq!(
        sqlx::query_scalar!("SELECT notification_id FROM user_notification")
            .fetch_all(&pool)
            .await
            .unwrap(),
        vec![fresh; 3]
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT notification_id FROM notification_message_receipt")
            .fetch_all(&pool)
            .await
            .unwrap(),
        vec![fresh; 3]
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM user_mute_notification")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn locked_parents_are_revisited_and_advisory_lock_is_transaction_scoped(pool: PgPool) {
    let oldest = insert(&pool, cutoff() - TimeDelta::days(2)).await;
    let next = insert(&pool, cutoff() - TimeDelta::days(1)).await;
    let repo = PgNotificationRetentionRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM notification WHERE id = $1 FOR UPDATE",
        oldest
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
    assert_eq!(remaining(&pool).await, [oldest]);
    assert_ne!(oldest, next);
    tx.rollback().await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    assert!(
        sqlx::query_scalar!(
            r#"SELECT pg_try_advisory_xact_lock($1) AS "locked!""#,
            RETENTION_LOCK
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap()
    );
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::Busy
    );
    tx.rollback().await.unwrap();
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cascade_lock_timeout_rolls_back_entire_batch_and_allows_retry(pool: PgPool) {
    let old = insert(&pool, cutoff() - TimeDelta::days(1)).await;
    sqlx::query!("INSERT INTO user_notification (user_id, notification_id) VALUES ('macro|locked@test.com', $1)", old)
        .execute(&pool).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT notification_id FROM user_notification WHERE notification_id = $1 FOR UPDATE",
        old
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    let repo = PgNotificationRetentionRepository::new(pool.clone());
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::TimedOut
    );
    assert_eq!(remaining(&pool).await, [old]);
    tx.rollback().await.unwrap();
    assert_eq!(
        repo.delete_batch(cutoff(), limit(100)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deletion_notifies_every_recipient_in_byte_bounded_chunks(pool: PgPool) {
    let old = insert(&pool, cutoff() - TimeDelta::days(1)).await;
    // Multibyte addresses ensure the trigger measures bytes, not characters.
    let users: Vec<_> = (0..500)
        .map(|i| format!("macro|retention-é-{i}@test.com"))
        .collect();
    sqlx::query!(
        "INSERT INTO user_notification (user_id, notification_id) SELECT unnest($1::text[]), $2",
        &users,
        old
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut listener = PgListener::connect_with(&pool).await.unwrap();
    listener.listen("notification_events").await.unwrap();
    let repo = PgNotificationRetentionRepository::new(pool.clone());
    assert_eq!(
        repo.delete_batch(cutoff(), limit(1)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
    let mut received = HashSet::new();
    let mut events = 0;
    while received.len() < users.len() {
        let event = tokio::time::timeout(std::time::Duration::from_secs(2), listener.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(event.payload().len() < 8000);
        let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
        assert_eq!(payload["type"], "user_notification_deletes");
        assert_eq!(payload["notificationId"], old.to_string());
        for user in payload["userIds"].as_array().unwrap() {
            assert!(received.insert(user.as_str().unwrap().to_owned()));
        }
        events += 1;
    }
    assert!(events > 1);
    assert_eq!(received, users.into_iter().collect());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn database_clock_uses_utc_even_with_a_non_utc_session(pool: PgPool) {
    let non_utc_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(
            pool.connect_options()
                .as_ref()
                .clone()
                .options([("TimeZone", "Pacific/Auckland")]),
        )
        .await
        .unwrap();
    let repo = PgNotificationRetentionRepository::new(non_utc_pool.clone());
    let now = repo.current_time().await.unwrap();
    assert!((Utc::now() - now).num_seconds().abs() < 5);
    let cutoff = (now - crate::domain::retention::RETENTION).naive_utc();
    insert(&pool, cutoff - TimeDelta::days(1)).await;
    let fresh = insert(&pool, cutoff + TimeDelta::days(1)).await;
    assert_eq!(
        repo.delete_batch(cutoff, limit(100)).await.unwrap(),
        RetentionBatch::Deleted(1)
    );
    assert_eq!(remaining(&pool).await, [fresh]);
    non_utc_pool.close().await;
}
