//! A user's team, through entity access (which team) and the teams
//! repository (who is in it).

use std::sync::Arc;

use entity_access::domain::ports::EntityAccessService;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::team_repo::TeamRepository;

use crate::domain::ports::TeamDirectory;

/// [`TeamDirectory`] over entity access and the teams repository.
pub struct TeamRoster<EntityAccess, Teams> {
    entity_access: Arc<EntityAccess>,
    teams: Arc<Teams>,
}

impl<EntityAccess, Teams> Clone for TeamRoster<EntityAccess, Teams> {
    fn clone(&self) -> Self {
        Self {
            entity_access: self.entity_access.clone(),
            teams: self.teams.clone(),
        }
    }
}

impl<EntityAccess, Teams> TeamRoster<EntityAccess, Teams> {
    /// Teams found through `entity_access`, members through `teams`.
    pub fn new(entity_access: Arc<EntityAccess>, teams: Arc<Teams>) -> Self {
        Self {
            entity_access,
            teams,
        }
    }
}

impl<EntityAccess, Teams> TeamDirectory for TeamRoster<EntityAccess, Teams>
where
    EntityAccess: EntityAccessService,
    Teams: TeamRepository + Send + Sync + 'static,
{
    async fn team_members(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        let mut members = vec![user.clone()];
        let team = self
            .entity_access
            .get_user_team(&user.0)
            .await
            .map_err(|error| rootcause::report!("reading the user's team: {error:?}"))?;
        let Some(team) = team else {
            return Ok(members);
        };
        let team_members = self
            .teams
            .get_team_members(&team.team_id)
            .await
            .map_err(|error| rootcause::report!("reading the team's members: {error:?}"))?;
        // The members list leaves the owner out.
        let owner = self
            .teams
            .get_team_owner(&team.team_id)
            .await
            .map_err(|error| rootcause::report!("reading the team's owner: {error:?}"))?;
        for member in std::iter::once(owner).chain(
            team_members
                .into_iter()
                .map(|member| member.user_id.into_owned()),
        ) {
            if !members.contains(&member) {
                members.push(member);
            }
        }
        Ok(members)
    }
}
