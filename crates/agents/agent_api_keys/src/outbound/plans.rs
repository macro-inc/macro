#[cfg(test)]
mod test;

use ai_billing::domain::EntitlementSource;

use crate::domain::{AgentKeyError, AgentOwner, KeyPlans, Result};

/// Agent keys come with a paid plan: Premium, Max, or an enterprise team. A
/// person's agent goes by their plan; a team's goes by the plan of the
/// team's payer, its owner.
pub struct EntitlementKeyPlans<Entitlements> {
    entitlements: Entitlements,
}

impl<Entitlements> EntitlementKeyPlans<Entitlements> {
    /// Read plans through `entitlements`.
    pub fn new(entitlements: Entitlements) -> Self {
        Self { entitlements }
    }
}

fn plan(error: impl std::error::Error + Send + Sync + 'static) -> AgentKeyError {
    AgentKeyError::Plan(error.into())
}

#[async_trait::async_trait]
impl<Entitlements: EntitlementSource> KeyPlans for EntitlementKeyPlans<Entitlements> {
    async fn allows_keys(&self, owner: &AgentOwner) -> Result<bool> {
        let payer = match owner {
            AgentOwner::User(user) => user.clone(),
            AgentOwner::Team(team_id) => {
                let Some(payer) = self.entitlements.team_payer(*team_id).await.map_err(plan)?
                else {
                    return Ok(false);
                };
                payer
            }
        };
        let entitlement = self.entitlements.entitlement(&payer).await.map_err(plan)?;
        Ok(entitlement.unlimited || entitlement.tier.is_paid())
    }
}
