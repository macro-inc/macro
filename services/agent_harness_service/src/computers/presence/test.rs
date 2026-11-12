use super::*;
use std::sync::Arc;

use agent_harness::domain::ports::{HarnessPresence, RuntimeConnectionId};
use agent_session::domain::model::ReplicaId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use crate::harness_bindings::PgHarnessPresence;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_close_preserves_replacement_on_another_replica(pool: PgPool) {
    let harness = HarnessId::new_from_uuid(macro_uuid::generate_uuid_v7());
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, kind, name, owner_user_id, created_by)
        VALUES ($1, 'macrod', 'Computer', 'macro|owner@example.com', 'macro|owner@example.com')
        "#,
        harness.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let first = Arc::new(PgHarnessPresence::new(pool.clone(), ReplicaId::mint()));
    let second = Arc::new(PgHarnessPresence::new(pool.clone(), ReplicaId::mint()));
    let old = RuntimeConnectionId::generate();
    let replacement = RuntimeConnectionId::generate();
    Arc::clone(&first).connected(harness, old).await;
    Arc::clone(&second).connected(harness, replacement).await;

    let mut old_close = PresenceGuard::lock(&pool, harness).await.unwrap();
    first.disconnected(harness, old).await;
    assert!(old_close.is_connected().await.unwrap());
    drop(old_close);

    let mut last_close = PresenceGuard::lock(&pool, harness).await.unwrap();
    second.disconnected(harness, replacement).await;
    assert!(!last_close.is_connected().await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lifecycle_guard_blocks_other_replicas_until_observation_finishes(pool: PgPool) {
    let harness = HarnessId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let guard = PresenceGuard::lock(&pool, harness).await.unwrap();
    let acquired = sqlx::query_scalar!(
        r#"
        SELECT pg_try_advisory_xact_lock(hashtextextended($1, 4973987001)) AS "acquired!"
        "#,
        harness.to_string(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!acquired);
    drop(guard);

    // Completing the guarded observer releases its lock for the next replica.
    let _next = PresenceGuard::lock(&pool, harness).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn observation_checks_lease_time_after_guard_started(pool: PgPool) {
    let harness = HarnessId::new_from_uuid(macro_uuid::generate_uuid_v7());
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, kind, name, owner_user_id, created_by)
        VALUES ($1, 'macrod', 'Computer', 'macro|owner@example.com', 'macro|owner@example.com')
        "#,
        harness.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let presence = Arc::new(PgHarnessPresence::new(pool.clone(), ReplicaId::mint()));
    presence
        .connected(harness, RuntimeConnectionId::generate())
        .await;
    let mut guard = PresenceGuard::lock(&pool, harness).await.unwrap();
    assert!(guard.is_connected().await.unwrap());
    sqlx::query!(
        r#"
        UPDATE harness_runtime_connection
        SET lease_expires_at = statement_timestamp()
        WHERE harness_id = $1
        "#,
        harness.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(!guard.is_connected().await.unwrap());
}
