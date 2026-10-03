//! Explicit, read-only team sharing. The creator retains execution and edit authority.
use super::models::{ActionExecutionRecord, ActionPolicyError, ScheduledAction};
use super::ports::ScheduledActionRepo;
use anyhow::Result;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// A routine and its optional audience. Personal routines are never inferred from membership.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SharedRoutine {
    #[serde(flatten)]
    pub action: ScheduledAction,
    pub team_id: Option<Uuid>,
}

pub trait RoutineSharingRepo: Send + Sync + 'static {
    fn get(&self, id: Uuid) -> impl Future<Output = Result<Option<SharedRoutine>>> + Send;
    fn list(&self, teams: Vec<Uuid>) -> impl Future<Output = Result<Vec<SharedRoutine>>> + Send;
    fn share(&self, id: Uuid, team: Option<Uuid>) -> impl Future<Output = Result<()>> + Send;
}

/// Membership facts supplied by the owning teams domain.
pub trait RoutineTeams: Send + Sync + 'static {
    fn teams(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Uuid>>> + Send;
}

pub trait RoutineSharingService: Send + Sync + 'static {
    fn list(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<SharedRoutine>>> + Send;
    fn get(
        &self,
        id: Uuid,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<SharedRoutine>> + Send;
    fn share(
        &self,
        id: Uuid,
        team: Option<Uuid>,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<SharedRoutine>> + Send;
    fn history(
        &self,
        id: Uuid,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<ActionExecutionRecord>>> + Send;
}

pub struct RoutineSharingServiceImpl<R, T, A> {
    repo: R,
    teams: T,
    actions: Arc<A>,
}
impl<R, T, A> RoutineSharingServiceImpl<R, T, A> {
    pub fn new(repo: R, teams: T, actions: Arc<A>) -> Self {
        Self {
            repo,
            teams,
            actions,
        }
    }
}
impl<R: RoutineSharingRepo, T: RoutineTeams, A: ScheduledActionRepo> RoutineSharingService
    for RoutineSharingServiceImpl<R, T, A>
{
    async fn list(&self, user: MacroUserIdStr<'static>) -> Result<Vec<SharedRoutine>> {
        let teams = self.teams.teams(&user).await?;
        if teams.is_empty() {
            return Ok(vec![]);
        }
        let routines = self.repo.list(teams.clone()).await?;
        Ok(routines
            .into_iter()
            .filter(|routine| routine.team_id.is_some_and(|team| teams.contains(&team)))
            .collect())
    }
    async fn get(&self, id: Uuid, user: MacroUserIdStr<'static>) -> Result<SharedRoutine> {
        let routine = self
            .repo
            .get(id)
            .await?
            .ok_or(ActionPolicyError::NotFound)?;
        if routine.action.owner.is_user(&user) {
            return Ok(routine);
        }
        if let Some(team) = routine.team_id
            && self.teams.teams(&user).await?.contains(&team)
        {
            return Ok(routine);
        }
        Err(ActionPolicyError::NotFound.into())
    }
    async fn share(
        &self,
        id: Uuid,
        team: Option<Uuid>,
        user: MacroUserIdStr<'static>,
    ) -> Result<SharedRoutine> {
        let mut routine = self
            .repo
            .get(id)
            .await?
            .ok_or(ActionPolicyError::NotFound)?;
        if !routine.action.owner.is_user(&user) {
            return Err(ActionPolicyError::NotFound.into());
        }
        if let Some(team) = team
            && !self.teams.teams(&user).await?.contains(&team)
        {
            return Err(ActionPolicyError::NotFound.into());
        }
        self.repo.share(id, team).await?;
        routine.team_id = team;
        Ok(routine)
    }
    async fn history(
        &self,
        id: Uuid,
        user: MacroUserIdStr<'static>,
    ) -> Result<Vec<ActionExecutionRecord>> {
        self.get(id, user).await?;
        self.actions.get_execution_records(&id).await
    }
}
