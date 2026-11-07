//! Team membership for the AI billing domain, through its ports.
//!
//! Billing declares what it reads ([`TeamSeats`]); this module serves it from
//! the teams repository, and serves teams' [`OpenSeatRelease`] port from the
//! billing service. Only composition roots enable it (feature `ai_billing`),
//! so neither domain compiles the other.

use ai_billing::domain::{
    BillingRepo, BillingServiceImpl, BillingTeam, EntitlementSource, PaymentGateway, PlanTier,
    SeatPlanTransition, TeamSeat, TeamSeats, UsageReader,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

use crate::domain::{
    model::{SeatPlan, TeamError},
    open_seat_release::{OpenSeatRelease, SeatPlanChange},
    team_repo::TeamRepository,
};
use crate::outbound::team_repo::TeamRepositoryImpl;

#[cfg(test)]
mod test;

/// The billing tier a team seat plan bills at.
pub fn plan_tier(plan: SeatPlan) -> PlanTier {
    match plan {
        SeatPlan::Premium => PlanTier::Premium,
        SeatPlan::Max => PlanTier::Max,
    }
}

impl TeamSeats for TeamRepositoryImpl {
    type Err = TeamError;

    async fn user_teams(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<BillingTeam>, TeamError> {
        Ok(self
            .get_user_teams(user)
            .await?
            .into_iter()
            .map(|team| BillingTeam {
                id: *team.id(),
                owner_id: team.owner_id().to_owned(),
                enterprise: team.enterprise(),
            })
            .collect())
    }

    async fn team_payment_status(&self, team_id: &Uuid) -> Result<bool, TeamError> {
        self.get_team_payment_status(team_id).await
    }

    async fn team_subscription_id(&self, team_id: &Uuid) -> Result<Option<String>, TeamError> {
        Ok(self
            .get_team_subscription_id(team_id)
            .await?
            .map(|id| id.to_string()))
    }

    async fn team_owner(
        &self,
        team_id: &Uuid,
    ) -> Result<Option<MacroUserIdStr<'static>>, TeamError> {
        match self.get_team_owner(team_id).await {
            Ok(owner) => Ok(Some(owner)),
            Err(TeamError::TeamDoesNotExist) => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn team_enterprise_status(&self, team_id: &Uuid) -> Result<bool, TeamError> {
        self.get_team_enterprise_status(team_id).await
    }

    async fn team_members(&self, team_id: &Uuid) -> Result<Vec<TeamSeat>, TeamError> {
        Ok(self
            .get_team_members(team_id)
            .await?
            .into_iter()
            .map(|member| TeamSeat {
                user_id: member.user_id.into_owned(),
                plan: plan_tier(member.plan),
            })
            .collect())
    }

    async fn stripe_customer_id(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<String>, TeamError> {
        Ok(self
            .get_stripe_customer_id(user)
            .await?
            .map(|id| id.to_string()))
    }
}

impl<E, U, R, P> OpenSeatRelease for BillingServiceImpl<E, U, R, P>
where
    E: EntitlementSource + Clone,
    U: UsageReader + Clone,
    R: BillingRepo + Clone,
    P: PaymentGateway + Clone,
{
    type Err = ai_billing::domain::BillingError;

    async fn change_plan(
        &self,
        member: &MacroUserIdStr<'_>,
        change: SeatPlanChange,
    ) -> Result<(), Self::Err> {
        self.change_seat_plan(
            member,
            SeatPlanTransition {
                from: change.from.map(plan_tier).unwrap_or(PlanTier::Free),
                to: plan_tier(change.to),
                at: change.at,
                period: change.period,
            },
        )
        .await
    }

    async fn release(&self, team_id: Uuid, member: &MacroUserIdStr<'_>) -> Result<(), Self::Err> {
        self.release_seat(team_id, member).await
    }
}
