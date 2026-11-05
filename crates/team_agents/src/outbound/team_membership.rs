//! Team membership and seats through the teams domain service.

use std::sync::Arc;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use teams::domain::model::RemoveUserFromTeamError;
use teams::domain::team_repo::{TeamRepository, TeamService};
use uuid::Uuid;

use crate::domain::models::{BillingInterval, SeatQuote, SubscriptionItem, TeamAgentError};
use crate::domain::ports::TeamMembership;

/// Adds agents to teams with the teams service.
pub struct TeamsMembership<Teams, Repository> {
    teams: Arc<Teams>,
    repository: Repository,
}

impl<Teams, Repository> TeamsMembership<Teams, Repository> {
    /// Wraps the teams service.
    pub fn new(teams: Arc<Teams>, repository: Repository) -> Self {
        Self { teams, repository }
    }
}

impl<Teams: TeamService, Repository: TeamRepository> TeamMembership
    for TeamsMembership<Teams, Repository>
{
    async fn team_admins(
        &self,
        team_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, TeamAgentError> {
        let mut admins = vec![
            self.repository
                .get_team_owner(&team_id)
                .await
                .map_err(TeamAgentError::internal)?,
        ];
        admins.extend(
            self.repository
                .get_team_members(&team_id)
                .await
                .map_err(TeamAgentError::internal)?
                .into_iter()
                .filter(|member| member.role == teams::domain::model::TeamRole::Admin)
                .map(|member| member.user_id.into_owned()),
        );
        Ok(admins)
    }

    async fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
        included: bool,
    ) -> Result<Option<SubscriptionItem>, TeamAgentError> {
        let seat = self
            .teams
            .add_team_agent(receipt, agent_user_id, !included)
            .await
            .map_err(TeamAgentError::internal)?;

        seat.map(|seat| {
            let quantity = u32::try_from(seat.quantity).map_err(TeamAgentError::internal)?;

            Ok(SubscriptionItem {
                price_id: seat.price_id,
                quantity,
            })
        })
        .transpose()
    }

    async fn undo_add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        match self
            .teams
            .undo_team_agent_join(receipt, agent_user_id)
            .await
        {
            Ok(()) | Err(RemoveUserFromTeamError::UserNotInTeam) => Ok(()),
            Err(error) => Err(TeamAgentError::internal(error)),
        }
    }

    async fn remove_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        match self
            .teams
            .remove_user_from_team(receipt, agent_user_id)
            .await
        {
            Ok(()) | Err(RemoveUserFromTeamError::UserNotInTeam) => Ok(()),
            Err(error) => Err(TeamAgentError::internal(error)),
        }
    }

    async fn quote_seat(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Option<SeatQuote>, TeamAgentError> {
        let quote = self
            .teams
            .quote_team_agent_seat(receipt)
            .await
            .map_err(TeamAgentError::internal)?;

        Ok(quote.map(|quote| SeatQuote {
            amount: quote.amount,
            currency: quote.currency,
            interval: match quote.interval {
                teams::domain::model::BillingInterval::Month => BillingInterval::Month,
                teams::domain::model::BillingInterval::Year => BillingInterval::Year,
            },
        }))
    }
}
