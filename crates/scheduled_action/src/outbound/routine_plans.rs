//! Routine owners' plans, read from their billing entitlements.

use ai_billing::PlanTier;
use ai_billing::domain::EntitlementSource;
use anyhow::Result;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::RoutinePlans;

#[cfg(test)]
mod test;

/// A user's own seat plan, or Max for a member of an enterprise team, whose
/// AI is billed out of band.
pub struct EntitlementRoutinePlans<Entitlements> {
    entitlements: Entitlements,
}

impl<Entitlements> EntitlementRoutinePlans<Entitlements> {
    /// Read plans through `entitlements`.
    pub fn new(entitlements: Entitlements) -> Self {
        Self { entitlements }
    }
}

impl<Entitlements: EntitlementSource> RoutinePlans for EntitlementRoutinePlans<Entitlements> {
    async fn plan(&self, owner: &MacroUserIdStr<'static>) -> Result<PlanTier> {
        let entitlement = self.entitlements.entitlement(owner).await?;
        Ok(if entitlement.unlimited {
            PlanTier::Max
        } else {
            entitlement.tier
        })
    }
}
