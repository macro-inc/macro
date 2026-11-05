//! Team membership and seats through the teams domain service.

use std::sync::Arc;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::model::RemoveUserFromTeamError;
use teams::domain::team_repo::TeamService;

use crate::domain::models::{BillingInterval, SeatQuote, SubscriptionItem, TeamAgentError};
use crate::domain::ports::TeamMembership;

/// Adds agents to teams with the teams service.
pub struct TeamsMembership<Teams> {
    teams: Arc<Teams>,
}

impl<Teams> TeamsMembership<Teams> {
    /// Wraps the teams service.
    pub fn new(teams: Arc<Teams>) -> Self {
        Self { teams }
    }
}

impl<Teams: TeamService> TeamMembership for TeamsMembership<Teams> {
    async fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<SubscriptionItem>, TeamAgentError> {
        let seat = self
            .teams
            .add_team_agent(receipt, agent_user_id)
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
