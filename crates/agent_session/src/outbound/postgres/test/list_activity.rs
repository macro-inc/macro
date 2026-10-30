use super::*;
use crate::domain::ports::SessionOwnership;
use crate::domain::recovery::StaleSessionRepo;
use agent_fold::domain::model::TurnState;
use chrono::{DateTime, Utc};

async fn modified_at(pool: &PgPool, id: AgentSessionId) -> DateTime<Utc> {
    sqlx::query_scalar!(
        "SELECT modified_at FROM agent_session WHERE id = $1",
        id.as_uuid()
    )
    .fetch_one(pool)
    .await
    .expect("read modified_at")
}

async fn age_list_timestamp(pool: &PgPool, id: AgentSessionId) -> DateTime<Utc> {
    sqlx::query_scalar!(
        "UPDATE agent_session SET modified_at = NOW() - INTERVAL '1 hour' WHERE id = $1 RETURNING modified_at",
        id.as_uuid()
    )
    .fetch_one(pool)
    .await
    .expect("age modified_at")
}

/// Unused sessions were showing "2m" because claim, release, recovery, and
/// connection events all stamped `modified_at`. Only open turn work should.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lease_and_connection_lifecycle_do_not_reorder_the_session_list(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let aged = age_list_timestamp(&pool, session.id).await;
    let replica = ReplicaId::mint();

    claimed(repo.claim(session.id, replica).await.expect("claim"));
    assert_eq!(modified_at(&pool, session.id).await, aged);

    let claim = claimed(
        repo.claim(session.id, replica)
            .await
            .expect("reclaim the same replica"),
    );
    assert_eq!(modified_at(&pool, session.id).await, aged);

    repo.release(&claim).await.expect("release");
    assert_eq!(modified_at(&pool, session.id).await, aged);

    append_system_event(&repo, session.id, SystemEvent::AcpReady).await;
    assert_eq!(modified_at(&pool, session.id).await, aged);

    repo.set_acp_session_id(session.id, SessionId::from("acp-session-1"))
        .await
        .expect("persist ACP session id");
    assert_eq!(modified_at(&pool, session.id).await, aged);

    append_system_event(&repo, session.id, SystemEvent::Disconnected).await;
    assert_eq!(modified_at(&pool, session.id).await, aged);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn open_turn_work_moves_the_session_list_and_disconnect_does_not(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let replica = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, replica).await.expect("claim"));
    let aged = age_list_timestamp(&pool, session.id).await;

    repo.create_projected(
        fenced_log(session.id),
        Some(&claim),
        None,
        Some(TurnState::Running),
    )
    .await
    .expect("project running turn");
    let after_work = modified_at(&pool, session.id).await;
    assert!(after_work > aged);

    repo.create_projected(
        fenced_log(session.id),
        Some(&claim),
        None,
        Some(TurnState::Disconnected),
    )
    .await
    .expect("project disconnect");
    assert_eq!(modified_at(&pool, session.id).await, after_work);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_recovery_does_not_reorder_the_session_list(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let replica = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, replica).await.expect("claim"));
    let aged = age_list_timestamp(&pool, session.id).await;
    let_heartbeat_go_stale(&pool, replica).await;

    assert!(
        repo.disconnect_stale_claim(claim)
            .await
            .expect("recover")
            .is_some()
    );
    assert_eq!(modified_at(&pool, session.id).await, aged);
}
