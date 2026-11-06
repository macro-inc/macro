//! Credits granted by an operator, e.g. to refund a user's usage.
//!
//! A grant is a positive `grant` entry in the payer's prepaid credit ledger,
//! in customer cents. Like purchased credits, it only funds paid usage beyond
//! a seat's allowance, at the overage markup; it does not reset the allowance.

use std::num::NonZeroU32;

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::{BillingError, EntitlementSource, PlanTier, Result};

#[cfg(test)]
mod test;

/// A grant to book. `id` makes it idempotent: booking the same id twice
/// leaves one entry.
#[derive(Debug, Clone)]
pub struct CreditGrant {
    /// Ledger entry id, a UUIDv7 chosen by the caller.
    pub id: Uuid,
    /// Customer cents to add to the payer's balance.
    pub amount_cents: NonZeroU32,
    /// Why the grant was issued and by whom; stored on the ledger entry.
    pub note: String,
}

/// Who a grant for a user lands on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantTarget {
    /// The account that owns the credit balance: the user, or their team owner.
    pub payer: MacroUserIdStr<'static>,
    /// The user's own plan.
    pub tier: PlanTier,
}

/// Persists credit grants.
pub trait CreditGrantRepo: Send + Sync + 'static {
    /// Book `grant` on `payer`'s ledger. Returns `false` when an entry with
    /// the grant's id already exists.
    fn record_credit_grant(
        &self,
        payer: &MacroUserIdStr<'_>,
        grant: &CreditGrant,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// The payer's prepaid credit balance in customer cents.
    fn credit_grant_balance_cents(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<i64>> + Send;
}

/// Grants credits to the account that pays for a user's AI usage.
pub struct CreditGrantService<Entitlements, Repo> {
    entitlements: Entitlements,
    repo: Repo,
}

impl<Entitlements, Repo> CreditGrantService<Entitlements, Repo>
where
    Entitlements: EntitlementSource,
    Repo: CreditGrantRepo,
{
    /// Build the service.
    pub fn new(entitlements: Entitlements, repo: Repo) -> Self {
        Self { entitlements, repo }
    }

    /// Resolve whose balance a grant for `user` would land on. Free users
    /// are hard-capped at their allowance, so credits cannot help them.
    pub async fn target(&self, user: &MacroUserIdStr<'_>) -> Result<GrantTarget> {
        let entitlement = self.entitlements.entitlement(user).await?;
        if !entitlement.tier.is_paid() {
            return Err(BillingError::FreePlan);
        }
        Ok(GrantTarget {
            payer: entitlement.payer,
            tier: entitlement.tier,
        })
    }

    /// The payer's current credit balance in customer cents.
    pub async fn balance_cents(&self, payer: &MacroUserIdStr<'_>) -> Result<i64> {
        self.repo.credit_grant_balance_cents(payer).await
    }

    /// Book `grant` for `user`'s payer. Returns the target and whether the
    /// grant was newly booked.
    #[tracing::instrument(skip(self, grant), fields(grant_id = %grant.id, amount_cents = grant.amount_cents), err)]
    pub async fn grant(
        &self,
        user: &MacroUserIdStr<'_>,
        grant: &CreditGrant,
    ) -> Result<(GrantTarget, bool)> {
        let target = self.target(user).await?;
        let inserted = self.repo.record_credit_grant(&target.payer, grant).await?;
        Ok((target, inserted))
    }
}
