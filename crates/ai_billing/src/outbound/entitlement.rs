//! Resolves a user's plan and payer from their roles and team membership.

use crate::domain::{BillingError, Entitlement, EntitlementSource, PayerScope, PlanTier, Result};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use teams::domain::team_repo::TeamRepository;

/// [`EntitlementSource`] over the roles service and the teams repository.
///
/// - A member of a paying (or enterprise) team is billed through the team
///   owner: the owner's tier applies to every seat, usage pools on the owner,
///   and enterprise teams are unlimited.
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
        let tier = if is_owner {
            own_tier
        } else {
            self.tier_of(&owner).await?
        };
        // Members carry the team's paid role even when the owner's own tier
        // role is missing (enterprise teams are provisioned by hand).
        let tier = if tier.is_paid() {
            tier
        } else {
            PlanTier::Premium
        };

        let members = self
            .teams
            .get_team_members(team.id())
            .await
            .map_err(entitlement_err)?;
        let mut billed_users = vec![owner.clone()];
        billed_users.extend(
            members
                .into_iter()
                .map(|m| m.user_id.into_owned())
                .filter(|m| m.as_ref() != owner.as_ref()),
        );

        Ok(Entitlement {
            tier,
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
