//! Team membership through the teams domain service.

use std::sync::Arc;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::model::RemoveUserFromTeamError;
use teams::domain::team_repo::TeamService;

use crate::domain::models::TeamAgentError;
use crate::domain::ports::TeamMembership;

/// Adds agents to teams with the teams service.
pub struct TeamsMembership<Teams> {
    teams: Arc<Teams>,
}

impl<Teams> TeamsMembership<Teams> {
    /// Wrap the teams service.
    pub fn new(teams: Arc<Teams>) -> Self {
        Self { teams }
    }
}

impl<Teams: TeamService> TeamMembership for TeamsMembership<Teams> {
    async fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.teams
            .add_team_agent(receipt, agent)
            .await
            .map(|_member| ())
            .map_err(TeamAgentError::internal)
    }

    async fn undo_add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        match self.teams.undo_team_agent_join(receipt, agent).await {
            Ok(()) | Err(RemoveUserFromTeamError::UserNotInTeam) => Ok(()),
            Err(error) => Err(TeamAgentError::internal(error)),
        }
    }

    async fn remove_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        match self.teams.remove_team_agent(receipt, agent).await {
            Ok(()) | Err(RemoveUserFromTeamError::UserNotInTeam) => Ok(()),
            Err(error) => Err(TeamAgentError::internal(error)),
        }
    }
}
