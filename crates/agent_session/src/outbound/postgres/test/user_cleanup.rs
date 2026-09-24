use super::*;
use crate::domain::ports::{
    NoOpAgentSessionNameGenerator, NoOpRealtime, NoOpTurnObserver, NoopLifecyclePublisher,
};
use crate::domain::service::{AgentSessionService, AgentSessionServiceImpl};
use agent_fold::domain::service::FoldedMessageService;
use std::sync::Arc;

/// The user is deliberately never deleted: no User cascade can make this pass.
/// Harness tests separately prove every selected row goes through teardown first.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_batches_remove_all_session_rows_without_a_user_cascade(pool: PgPool) {
    const OTHER: &str = "macro|cleanup-other@example.com";
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    insert_user(&pool, OTHER).await;
    for _ in 0..101 {
        create_session(&repo, new_session(bot, None, None)).await;
    }
    let other = create_session(
        &repo,
        CreateAgentSessionParams {
            owner_id: Owner::User(user_id(OTHER)),
            ..new_session(bot, None, None)
        },
    )
    .await;
    let service = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );
    let mut deleted = 0;
    loop {
        let batch = service
            .sessions_for_user_cleanup(&user_id(OWNER))
            .await
            .unwrap();
        if batch.is_empty() {
            break;
        }
        assert!(batch.len() <= 100);
        for session in batch {
            service.delete_session(session.id).await.unwrap();
            assert!(AgentSessionRepo::get(&repo, session.id).await.is_err());
            deleted += 1;
        }
    }
    assert_eq!(deleted, 101);
    assert!(
        service
            .sessions_for_user_cleanup(&user_id(OWNER))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(AgentSessionRepo::get(&repo, other.id).await.is_ok());
}
