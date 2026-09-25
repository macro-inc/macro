use super::*;
use crate::domain::models::InProgressExecution;
use crate::domain::ports::{ScheduledActionExecutor, ScheduledActionService};
use crate::domain::service::ScheduledActionServiceImpl;
use std::sync::Arc;

struct NeverExecutor;
impl ScheduledActionExecutor for NeverExecutor {
    async fn execute_action(&self, _: ScheduledAction) -> Result<InProgressExecution> {
        panic!("cleanup must not execute actions")
    }
}

/// Both User rows remain throughout, ruling out ON DELETE CASCADE entirely.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deletes_user_actions_without_cascade_and_preserves_other_users(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = Arc::new(PgScheduledActionRepo::new(pool.clone()));
    let enabled = repo
        .create_action(sample_action(user_owner(USER_A), "enabled"))
        .await
        .unwrap();
    let disabled = repo
        .create_action(ScheduledAction {
            enabled: false,
            ..sample_action(user_owner(USER_A), "disabled")
        })
        .await
        .unwrap();
    repo.claim_action(&enabled.id.unwrap()).await.unwrap();
    let event = repo.create_action(event_action()).await.unwrap();
    let other = repo
        .create_action(sample_action(user_owner(USER_B), "other"))
        .await
        .unwrap();
    let (tx, _rx) = tokio::sync::mpsc::channel(10);
    let service = ScheduledActionServiceImpl::new(repo.clone(), Arc::new(NeverExecutor), tx);

    service.delete_user_actions(user(USER_A)).await.unwrap();
    service.delete_user_actions(user(USER_A)).await.unwrap();
    assert!(repo.get_actions(user(USER_A)).await.unwrap().is_empty());
    for id in [enabled.id.unwrap(), disabled.id.unwrap(), event.id.unwrap()] {
        assert_eq!(scheduled_action_row_count(&pool, id).await, 0);
        assert_eq!(entity_row_count(&pool, id).await, 0);
    }
    assert_eq!(
        scheduled_action_row_count(&pool, other.id.unwrap()).await,
        1
    );
}
