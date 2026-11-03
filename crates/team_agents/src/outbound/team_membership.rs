//! Team membership through the teams domain service.

use std::sync::Arc;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::team_repo::TeamService;

use crate::domain::models::TeamAgentError;
use crate::domain::ports::TeamMembership;

/// Adds agents to teams with the teams service.
pub struct TeamsMembership<T> {
    teams: Arc<T>,
}

impl<T> TeamsMembership<T> {
    /// Wraps the teams service.
    pub fn new(teams: Arc<T>) -> Self {
        Self { teams }
    }
}

impl<T: TeamService> TeamMembership for TeamsMembership<T> {
    async fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.teams
            .add_team_agent(receipt, agent_user_id)
            .await
            .map_err(TeamAgentError::internal)?;

        Ok(())
    }
}
