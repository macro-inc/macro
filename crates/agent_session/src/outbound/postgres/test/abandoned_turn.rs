use super::*;
use crate::domain::abandoned_turn::AbandonedTurnRepo;
use agent_fold::domain::model::TurnState;
use std::time::Duration;

/// Everything the sweep asks for is "as of now", so the fixtures move the
/// clock instead: this is the session's whole log aged past any quiet period.
async fn let_the_log_go_quiet(pool: &PgPool, session: AgentSessionId) {
    sqlx::query!(
        r#"UPDATE agent_session_log SET created_at = now() - interval '10 minutes' WHERE agent_session_id = $1"#,
        session.as_uuid(),
    )
    .execute(pool)
    .await
    .expect("backdate session log");
}

async fn open_turn(repo: &PgAgentSessionRepo, session: AgentSessionId, claim: &SessionClaim) {
    repo.create_projected(
        fenced_log(session),
        Some(claim),
        None,
        Some(TurnState::Running),
    )
    .await
    .expect("project an open turn");
}

async fn abandoned(repo: &PgAgentSessionRepo) -> Vec<AgentSessionId> {
    repo.abandoned_turns(Duration::from_secs(120), NonZeroUsize::new(10).unwrap())
        .await
        .expect("list abandoned turns")
}

/// The sweep's whole premise: a turn is abandoned when it is open, quiet, and
/// the replica that was driving it has stopped beating. Each of those three
/// on its own keeps a session out of the list.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_open_turn_is_abandoned_only_once_its_holder_goes_stale_and_quiet(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let holder = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, holder).await.expect("claim"));
    open_turn(&repo, session.id, &claim).await;

    // A live holder is driving it, however long it has been since a frame.
    let_the_log_go_quiet(&pool, session.id).await;
    assert_eq!(abandoned(&repo).await, Vec::new());

    // Its holder stopped beating, but it was streaming a moment ago: still
    // within the grace a slow or shutting-down replica is owed.
    let_heartbeat_go_stale(&pool, holder).await;
    repo.create_projected(
        fenced_log(session.id),
        Some(&claim),
        None,
        Some(TurnState::Running),
    )
    .await
    .expect("one more frame");
    assert_eq!(abandoned(&repo).await, Vec::new());

    // Stale and quiet: nothing is going to write this turn's ending.
    let_the_log_go_quiet(&pool, session.id).await;
    assert_eq!(abandoned(&repo).await, vec![session.id]);

    // And a settled turn is not the sweep's business, however long ago it
    // settled or how dead the replica that closed it is.
    repo.create_projected(
        fenced_log(session.id),
        Some(&claim),
        None,
        Some(TurnState::Idle),
    )
    .await
    .expect("settle the turn");
    let_the_log_go_quiet(&pool, session.id).await;
    assert_eq!(abandoned(&repo).await, Vec::new());
}

/// A session projected open by a writer that died before its first frame has
/// no log to age, and would be invisible to a query that only looks at one.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_with_no_log_at_all_falls_back_to_its_own_age(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    sqlx::query!(
        r#"UPDATE agent_session SET turn_state = 'starting', created_at = now() - interval '10 minutes' WHERE id = $1"#,
        session.id.as_uuid(),
    )
    .execute(&pool)
    .await
    .expect("project a turn that never wrote a frame");

    assert_eq!(abandoned(&repo).await, vec![session.id]);
}

/// Unprojected sessions predate the projection; the sweep must not guess an
/// open turn for them.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_with_no_projection_is_never_abandoned(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    sqlx::query!(
        r#"UPDATE agent_session SET created_at = now() - interval '10 minutes' WHERE id = $1"#,
        session.id.as_uuid(),
    )
    .execute(&pool)
    .await
    .expect("age the session");

    assert_eq!(abandoned(&repo).await, Vec::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pass_is_bounded(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let replica = ReplicaId::mint();
    for _ in 0..3 {
        let session = create_session(&repo, new_session(bot_id, None, None)).await;
        let claim = claimed(repo.claim(session.id, replica).await.expect("claim"));
        open_turn(&repo, session.id, &claim).await;
        let_the_log_go_quiet(&pool, session.id).await;
    }
    let_heartbeat_go_stale(&pool, replica).await;

    let page = repo
        .abandoned_turns(Duration::from_secs(120), NonZeroUsize::new(2).unwrap())
        .await
        .expect("list abandoned turns");

    assert_eq!(page.len(), 2);
    assert_eq!(abandoned(&repo).await.len(), 3);
}
