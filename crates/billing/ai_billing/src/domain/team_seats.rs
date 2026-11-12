//! Team membership facts billing reads to resolve payers and seats.
//!
//! The teams domain implements this port; billing never reads team storage.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::models::PlanTier;

/// A team a user belongs to, as billing sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingTeam {
    /// The team.
    pub id: Uuid,
    /// The team owner, who pays for a billed team.
    pub owner_id: String,
    /// Enterprise teams bill every seat and have no usage limit.
    pub enterprise: bool,
}

/// One membership row and the plan its seat is billed at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamSeat {
    /// The member.
    pub user_id: MacroUserIdStr<'static>,
    /// The seat's plan.
    pub plan: PlanTier,
}

/// Read-only team membership, payment and Stripe customer facts.
pub trait TeamSeats: Clone + Send + Sync + 'static {
    /// Error returned when a read fails.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The teams `user` belongs to, oldest membership first.
    fn user_teams(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<BillingTeam>, Self::Err>> + Send;

    /// Whether the team has a paying subscription on record.
    fn team_payment_status(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The team's Stripe subscription id, kept after a cancellation.
    fn team_subscription_id(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// The team's owner, or `None` when the team does not exist.
    fn team_owner(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, Self::Err>> + Send;

    /// Whether the team is an enterprise team.
    fn team_enterprise_status(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Every membership row of the team, with its seat plan.
    fn team_members(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<TeamSeat>, Self::Err>> + Send;

    /// The Stripe customer recorded for `user`.
    fn stripe_customer_id(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}
