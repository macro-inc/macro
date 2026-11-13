//! Team roles through the teams domain's repository port.

use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::model::{TeamError, TeamRole};
use teams::domain::team_repo::TeamRepository;
use uuid::Uuid;

use crate::domain::ports::TeamAdmins;

/// Reads roles with the teams crate's [`TeamRepository`].
pub struct TeamRepositoryAdmins<Teams> {
    teams: Teams,
}

impl<Teams> TeamRepositoryAdmins<Teams> {
    /// Wrap the teams repository.
    pub fn new(teams: Teams) -> Self {
        Self { teams }
    }
}

impl<Teams: TeamRepository> TeamAdmins for TeamRepositoryAdmins<Teams> {
    type Err = TeamError;

    async fn is_team_admin(
        &self,
        team_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, TeamError> {
        let role = self.teams.get_team_role(&team_id, user_id).await?;

        Ok(matches!(role, Some(TeamRole::Admin | TeamRole::Owner)))
    }
}
