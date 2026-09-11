//! Resolves a user's plan and payer from their roles and team membership.

use crate::domain::{BillingError, Entitlement, EntitlementSource, PayerScope, PlanTier, Result};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use teams::domain::team_repo::TeamRepository;

/// [`EntitlementSource`] over the roles service and the teams repository.
///
/// - A member of a paying (or enterprise) team is billed through the team
///   owner: usage pools on the owner and every seat adds its own plan's
///   allowance (a team may mix Premium and Max seats). Each member's plan is
///   the one recorded on their membership; enterprise teams are unlimited.
/// - Everyone else is a personal account on whatever tier their roles say.
#[derive(Clone)]
pub struct RolesTeamsEntitlementSource<P, T> {
    permissions: P,
    teams: T,
}

impl<P, T> RolesTeamsEntitlementSource<P, T> {
    /// Build the resolver.
    pub fn new(permissions: P, teams: T) -> Self {
        Self { permissions, teams }
    }
}

fn entitlement_err(e: impl std::error::Error + Send + Sync + 'static) -> BillingError {
    BillingError::Entitlement(e.into())
}

impl<P, T> RolesTeamsEntitlementSource<P, T>
where
    P: UserRolesAndPermissionsService,
    T: TeamRepository,
{
    async fn tier_of(&self, user: &MacroUserIdStr<'_>) -> Result<PlanTier> {
        let roles = self
            .permissions
            .get_user_roles(user)
            .await
            .map_err(entitlement_err)?;
        Ok(PlanTier::from_roles(&roles))
    }
}

impl<P, T> EntitlementSource for RolesTeamsEntitlementSource<P, T>
where
    P: UserRolesAndPermissionsService,
    T: TeamRepository,
{
    #[tracing::instrument(skip(self), err)]
    async fn entitlement(&self, user: &MacroUserIdStr<'_>) -> Result<Entitlement> {
        let user_owned = user.clone().into_owned();
        let own_tier = self.tier_of(user).await?;

        let teams = self
            .teams
            .get_user_teams(user)
            .await
            .map_err(entitlement_err)?;
        let Some(team) = teams.into_iter().next() else {
            return Ok(Entitlement::personal(user_owned, own_tier));
        };

        let subscription = self
            .teams
            .get_team_subscription_id(team.id())
            .await
            .map_err(entitlement_err)?;
        if !team.enterprise() && subscription.is_none() {
            // A free team: everyone pays for themself.
            return Ok(Entitlement::personal(user_owned, own_tier));
        }

        let owner = MacroUserIdStr::parse_from_str(team.owner_id())
            .map_err(entitlement_err)?
            .into_owned();
        let is_owner = owner.as_ref() == user.as_ref();

        // Every membership row (the owner has one too) carries the plan its
        // seat is billed at. A team member row that somehow lacks one, or an
        // owner without a row, counts as a Premium seat: that is the plan
        // every seat starts on.
        let members = self
            .teams
            .get_team_members(team.id())
            .await
            .map_err(entitlement_err)?;
        let mut seats: Vec<(MacroUserIdStr<'static>, PlanTier)> =
            Vec::with_capacity(members.len() + 1);
        for member in members {
            let member_id = member.user_id.into_owned();
            if seats
                .iter()
                .any(|(id, _)| id.as_ref() == member_id.as_ref())
            {
                continue;
            }
            seats.push((member_id, PlanTier::from(member.plan)));
        }
        if !seats.iter().any(|(id, _)| id.as_ref() == owner.as_ref()) {
            seats.insert(0, (owner.clone(), PlanTier::Premium));
        }
        let tier = seats
            .iter()
            .find(|(id, _)| id.as_ref() == user.as_ref())
            .map(|(_, tier)| *tier)
            .unwrap_or(PlanTier::Premium);
        let (billed_users, seat_tiers): (Vec<_>, Vec<_>) = seats.into_iter().unzip();

        Ok(Entitlement {
            tier,
            seat_tiers,
            unlimited: team.enterprise(),
            payer: owner,
            billed_users,
            scope: if is_owner {
                PayerScope::TeamOwner {
                    team_id: *team.id(),
                }
            } else {
                PayerScope::TeamMember {
                    team_id: *team.id(),
                }
            },
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn stripe_customer_id(&self, user: &MacroUserIdStr<'_>) -> Result<Option<String>> {
        Ok(self
            .teams
            .get_stripe_customer_id(user)
            .await
            .map_err(entitlement_err)?
            .map(|id| id.to_string()))
    }
}
