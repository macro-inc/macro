use super::*;
use crate::domain::ports::AgentSessionRealtime;
use crate::domain::recovery::{StaleSessionRepo, recover_stale_sessions};
use agent_fold::domain::lifecycle::LifecycleFold;
use agent_fold::domain::model::TurnState;
use agent_fold::testing::{TURN, parse_log_as};
use std::sync::Mutex;

#[derive(Default)]
struct Realtime(Mutex<Vec<AgentSessionId>>);

impl AgentSessionRealtime for Realtime {
    async fn publish(
        &self,
        _event: crate::domain::model::LogAppended,
    ) -> std::result::Result<(), rootcause::Report> {
        panic!("recovery must invalidate snapshots, never send stale live frames");
    }

    async fn publish_updated(
        &self,
        session: AgentSessionId,
    ) -> std::result::Result<(), rootcause::Report> {
        self.0.lock().unwrap().push(session);
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovery_preserves_history_closes_stale_turn_and_fences_old_writer(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let replica = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, replica).await.unwrap());
    let mut fold = LifecycleFold::new();
    for frame in parse_log_as(session.id, TURN) {
        let prompt = matches!(&frame.content, Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request)))) if request.method.as_ref() == "session/prompt");
        let _ = fold.push(frame.clone());
        repo.create_projected(
            frame,
            Some(&claim),
            None,
            Some(fold.inner().metadata().turn),
        )
        .await
        .unwrap();
        if prompt {
            break;
        }
    }
    assert_eq!(fold.inner().metadata().turn, TurnState::Running);
    // Batched writes can leave their final microseconds ahead of wall time.
    // Both recovery and the successor must remain after that durable tail.
    sqlx::query!(
        "UPDATE agent_session_log SET created_at = created_at + interval '1 second' WHERE agent_session_id = $1",
        session.id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let before = repo.list_by_session(session.id).await.unwrap();
    let_heartbeat_go_stale(&pool, replica).await;
    let realtime = Realtime::default();
    assert_eq!(
        recover_stale_sessions(&repo, &realtime, NonZeroUsize::new(10).unwrap())
            .await
            .unwrap(),
        1
    );
    let after = repo.list_by_session(session.id).await.unwrap();
    assert_eq!(after.len(), before.len() + 1);
    assert_eq!(
        before.iter().map(|v| v.id).collect::<Vec<_>>(),
        after[..before.len()]
            .iter()
            .map(|v| v.id)
            .collect::<Vec<_>>()
    );
    let _ = fold.push(after.last().unwrap().entry.clone());
    assert_eq!(fold.inner().metadata().turn, TurnState::Disconnected);
    assert!(after.last().unwrap().created_at > before.last().unwrap().created_at);
    let projected = sqlx::query_scalar!(
        "SELECT turn_state FROM agent_session WHERE id = $1",
        session.id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(projected.as_deref(), Some("disconnected"));
    assert_eq!(realtime.0.lock().unwrap()[0], session.id);
    assert!(matches!(
        repo.create_fenced(fenced_log(session.id), &claim).await,
        Err(AgentSessionError::FencedOut(_))
    ));
    assert_eq!(
        recover_stale_sessions(&repo, &realtime, NonZeroUsize::new(10).unwrap())
            .await
            .unwrap(),
        0
    );
    assert_eq!(realtime.0.lock().unwrap().len(), 1);
    let resumed = claimed(repo.claim(session.id, ReplicaId::mint()).await.unwrap());
    assert_eq!(resumed.fence.0, claim.fence.0 + 2);
    let ready = repo
        .create_fenced(
            AgentSessionLog {
                agent_session_id: session.id,
                user_id: None,
                content: Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::AcpReady,
                }),
            },
            &resumed,
        )
        .await
        .unwrap();
    assert!(ready.created_at > after.last().unwrap().created_at);
    let batch = repo
        .create_batch_fenced(
            vec![StoredAgentSessionLog {
                id: macro_uuid::generate_uuid_v7(),
                created_at: chrono::Utc::now(),
                entry: fenced_log(session.id),
            }],
            &resumed,
        )
        .await
        .unwrap();
    assert!(batch[0].created_at > ready.created_at);
    let mut replay = LifecycleFold::new();
    for row in repo.list_by_session(session.id).await.unwrap() {
        let _ = replay.push(row.entry);
    }
    assert_ne!(replay.inner().metadata().turn, TurnState::Disconnected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovery_is_bounded_and_leaves_live_and_draining_holders_alone(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let live = create_session(&repo, new_session(bot, None, None)).await;
    let live_replica = ReplicaId::mint();
    let live_claim = claimed(repo.claim(live.id, live_replica).await.unwrap());
    repo.begin_draining(live_replica).await.unwrap();
    assert!(
        repo.disconnect_stale_claim(live_claim)
            .await
            .unwrap()
            .is_none()
    );
    for _ in 0..3 {
        let session = create_session(&repo, new_session(bot, None, None)).await;
        let replica = ReplicaId::mint();
        claimed(repo.claim(session.id, replica).await.unwrap());
        let_heartbeat_go_stale(&pool, replica).await;
    }
    let realtime = Realtime::default();
    let limit = NonZeroUsize::new(2).unwrap();
    assert_eq!(
        recover_stale_sessions(&repo, &realtime, limit)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        recover_stale_sessions(&repo, &realtime, limit)
            .await
            .unwrap(),
        1
    );
    assert!(repo.list_by_session(live.id).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn refreshed_heartbeat_wins_while_recovery_waits_for_its_lock(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let replica = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, replica).await.unwrap());
    let_heartbeat_go_stale(&pool, replica).await;
    let mut heartbeat = pool.begin().await.unwrap();
    sqlx::query!(
        "UPDATE harness_replica SET last_heartbeat_at = now() WHERE id = $1",
        replica.as_uuid()
    )
    .execute(&mut *heartbeat)
    .await
    .unwrap();
    let recovering = repo.clone();
    let mut pending = tokio::spawn(async move { recovering.disconnect_stale_claim(claim).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut pending)
            .await
            .is_err()
    );
    heartbeat.commit().await.unwrap();
    assert!(pending.await.unwrap().unwrap().is_none());
    repo.create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn successor_claim_wins_while_recovery_waits_for_the_session_lock(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let old = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, old).await.unwrap());
    let_heartbeat_go_stale(&pool, old).await;
    let successor = ReplicaId::mint();
    repo.heartbeat(successor, None).await.unwrap();
    let mut takeover = pool.begin().await.unwrap();
    sqlx::query!("UPDATE agent_session SET manager_replica_id = $2, manager_fence = manager_fence + 1 WHERE id = $1", session.id.as_uuid(), successor.as_uuid()).execute(&mut *takeover).await.unwrap();
    let recovering = repo.clone();
    let mut pending = tokio::spawn(async move { recovering.disconnect_stale_claim(claim).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut pending)
            .await
            .is_err()
    );
    takeover.commit().await.unwrap();
    assert!(pending.await.unwrap().unwrap().is_none());
    assert!(repo.list_by_session(session.id).await.unwrap().is_empty());
    assert_eq!(
        repo.lease_view(session.id, successor)
            .await
            .unwrap()
            .holder
            .unwrap()
            .replica,
        successor
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn simultaneous_recoveries_append_only_one_disconnect(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let replica = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, replica).await.unwrap());
    let_heartbeat_go_stale(&pool, replica).await;
    let (left, right) = tokio::join!(
        repo.disconnect_stale_claim(claim),
        repo.disconnect_stale_claim(claim),
    );
    assert_eq!(
        usize::from(left.unwrap().is_some()) + usize::from(right.unwrap().is_some()),
        1
    );
    assert_eq!(repo.list_by_session(session.id).await.unwrap().len(), 1);
}
