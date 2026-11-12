//! The daily Stripe audit's comparison with team and personal plan state.
//! Detects only; it never changes either side.

use std::sync::Arc;

use roles_and_permissions::domain::model::RoleId;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use stripe_inbox::domain::audit::{Mismatch, MismatchKind};
use stripe_inbox::domain::model::SubscriptionFacts;
use stripe_inbox::domain::ports::DomainAudit;
use teams::domain::team_repo::TeamRepository;

use crate::outbound::stripe_identity::PgStripeIdentity;

/// Compares a Stripe subscription with what teams and roles hold.
pub struct StripeDomainAudit<Teams, Roles> {
    pub teams: Teams,
    pub roles: Arc<Roles>,
    pub identity: PgStripeIdentity,
}

impl<Teams, Roles> DomainAudit for StripeDomainAudit<Teams, Roles>
where
    Teams: TeamRepository,
    Roles: UserRolesAndPermissionsService,
{
    async fn check(
        &self,
        subscription: &SubscriptionFacts,
    ) -> Result<Vec<Mismatch>, rootcause::Report> {
        let found = match subscription.team_id {
            Some(team_id) => self.check_team(team_id, subscription).await,
            None => self.check_personal(subscription).await,
        };
        // One unreadable team or account never stops the sweep.
        Ok(found
            .inspect_err(|error| {
                tracing::warn!(
                    subscription_id = %subscription.id,
                    error = ?error,
                    "stripe audit could not read domain state"
                );
            })
            .unwrap_or_default()
            .into_iter()
            .collect())
    }
}

impl<Teams, Roles> StripeDomainAudit<Teams, Roles>
where
    Teams: TeamRepository,
    Roles: UserRolesAndPermissionsService,
{
    /// The team's current subscription must be this one while it is live,
    /// and the team pays exactly while its current subscription is live.
    async fn check_team(
        &self,
        team_id: uuid::Uuid,
        subscription: &SubscriptionFacts,
    ) -> anyhow::Result<Option<Mismatch>> {
        let bound = self
            .teams
            .get_team_subscription_id(&team_id)
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let is_current = bound.as_ref() == Some(&subscription.id);
        if !is_current && !subscription.is_live() {
            return Ok(None);
        }
        let paying = self
            .teams
            .get_team_payment_status(&team_id)
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        if is_current && paying == subscription.is_live() {
            return Ok(None);
        }
        Ok(Some(Mismatch {
            kind: MismatchKind::TeamBilling,
            object_id: subscription.id.to_string(),
            stripe_value: Some(serde_json::json!({
                "team_id": team_id,
                "status": subscription.status.as_str(),
            })),
            macro_value: Some(serde_json::json!({
                "subscription_id": bound.map(|id| id.to_string()),
                "paying": paying,
            })),
        }))
    }

    /// A live personal subscription's account holds the subscriber role.
    async fn check_personal(
        &self,
        subscription: &SubscriptionFacts,
    ) -> anyhow::Result<Option<Mismatch>> {
        if !subscription.is_live() {
            return Ok(None);
        }
        let Some(user) = self
            .identity
            .user_for_customer(&subscription.customer)
            .await?
        else {
            return Ok(None);
        };
        let roles = self
            .roles
            .get_user_roles(&user)
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        if roles.contains(&RoleId::ProfessionalSubscriber) {
            return Ok(None);
        }
        Ok(Some(Mismatch {
            kind: MismatchKind::PersonalPlan,
            object_id: subscription.id.to_string(),
            stripe_value: Some(serde_json::json!({ "status": subscription.status.as_str() })),
            macro_value: Some(serde_json::json!({ "professional_subscriber": false })),
        }))
    }
}
