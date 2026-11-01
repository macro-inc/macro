use super::*;
use crate::domain::models::InProgressExecution;
use crate::domain::ports::{ScheduledActionExecutor, ScheduledActionService};
use crate::domain::service::ScheduledActionServiceImpl;
use entity_access::domain::{models::AccessError, ports::ScheduledActionGrants};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use std::sync::Arc;

struct UnusedGrants;
impl ScheduledActionGrants for UnusedGrants {
    async fn accessible_scheduled_action_ids(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> std::result::Result<Vec<macro_uuid::Uuid>, AccessError> {
        Ok(Vec::new())
    }
}

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
    let repo = Arc::new(super::test_repo(pool.clone()));
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
    repo.claim_action(
        &enabled.id.unwrap(),
        enabled.configuration_revision,
        enabled.next_run_at,
    )
    .await
    .unwrap();
    let event = repo.create_action(event_action()).await.unwrap();
    let other = repo
        .create_action(sample_action(user_owner(USER_B), "other"))
        .await
        .unwrap();
    let (tx, _rx) = tokio::sync::mpsc::channel(10);
    let service = ScheduledActionServiceImpl::new(
        repo.clone(),
        Arc::new(NeverExecutor),
        tx,
        Arc::new(UnusedGrants),
    );

    service.delete_user_actions(user(USER_A)).await.unwrap();
    service.delete_user_actions(user(USER_A)).await.unwrap();
    assert!(
        repo.get_owned_actions(&user(USER_A))
            .await
            .unwrap()
            .is_empty()
    );
    for id in [enabled.id.unwrap(), disabled.id.unwrap(), event.id.unwrap()] {
        assert_eq!(scheduled_action_row_count(&pool, id).await, 0);
        assert_eq!(entity_row_count(&pool, id).await, 0);
    }
    assert_eq!(
        scheduled_action_row_count(&pool, other.id.unwrap()).await,
        1
    );
}
