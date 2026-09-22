use std::sync::Arc;

use anyhow::{Result, bail};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::mpsc::Sender;

use super::models::{ActionExecutionRecord, DispatchEvent, InProgressExecution, ScheduledAction};
use super::ports::{ScheduledActionExecutor, ScheduledActionRepo, ScheduledActionService};

/// True when `action` is the caller's own action.
///
/// The repository already filters by the caller's principal, so this is the
/// second half of the same statement: the row is only theirs when its owner is
/// that user rather than a bot or a team that happens to share the string.
fn is_owned_by(action: &ScheduledAction, caller: &MacroUserIdStr<'static>) -> bool {
    action.owner.is_user(caller)
}

pub struct ScheduledActionServiceImpl<Rpo, Exe> {
    repo: Arc<Rpo>,
    executor: Arc<Exe>,
    dispatcher_tx: Sender<DispatchEvent>,
}

impl<Rpo: ScheduledActionRepo, Exe> ScheduledActionServiceImpl<Rpo, Exe> {
    pub fn new(repo: Arc<Rpo>, executor: Arc<Exe>, dispatcher_tx: Sender<DispatchEvent>) -> Self {
        Self {
            repo,
            executor,
            dispatcher_tx,
        }
    }

    async fn owned_action(
        &self,
        id: &Uuid,
        caller: &MacroUserIdStr<'static>,
    ) -> Result<ScheduledAction> {
        let action = self.repo.get_action(id, caller.clone()).await?;
        match action {
            Some(action) if is_owned_by(&action, caller) => Ok(action),
            _ => bail!("scheduled action {id} not found for user"),
        }
    }
}

impl<Rpo, Exe> ScheduledActionService for ScheduledActionServiceImpl<Rpo, Exe>
where
    Rpo: ScheduledActionRepo,
    Exe: ScheduledActionExecutor + Send + Sync + 'static,
{
    async fn create_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let created = self.repo.create_action(action).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Create(created.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch create event: {e}"))?;
        Ok(created)
    }

    async fn get_actions(&self, user_id: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        self.repo.get_actions(user_id).await
    }

    async fn update_action(
        &self,
        action: ScheduledAction,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<ScheduledAction> {
        let Some(id) = action.id else {
            bail!("cannot update action without id");
        };
        self.owned_action(&id, &macro_user_id).await?;

        let updated = self.repo.update_action(action).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Update(updated.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch update event: {e}"))?;
        Ok(updated)
    }

    async fn delete_action(&self, id: &Uuid, macro_user_id: MacroUserIdStr<'static>) -> Result<()> {
        let action = self.owned_action(id, &macro_user_id).await?;

        self.repo.delete_action(id, macro_user_id).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Delete(action))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch delete event: {e}"))?;
        Ok(())
    }

    async fn execute_action_now(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<InProgressExecution> {
        let action = self.owned_action(id, &macro_user_id).await?;

        self.executor.execute_action(action).await
    }

    async fn get_execution_records(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ActionExecutionRecord>> {
        self.owned_action(id, &macro_user_id).await?;

        self.repo.get_execution_records(id).await
    }
}
