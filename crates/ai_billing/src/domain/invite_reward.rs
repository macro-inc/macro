//! The reward for bringing someone to Macro: an inviter or referrer earns AI
//! for each person who joins their team or signs up through their link.
//!
//! A paid user's payer gets [`REWARD_CREDIT_CUSTOMER_CENTS`] of prepaid credit.
//! A free user, who cannot spend credit, gets [`FREE_BONUS_COST_CENTS`] more
//! monthly allowance, up to [`FREE_BONUS_CAP_COST_CENTS`] in total.
//! Enterprise (unlimited) users need nothing. Each reward is keyed by the event
//! that earned it, so a retried event never pays twice.

use std::num::NonZeroU32;

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::Result;
use super::credit_grant::{CreditGrant, CreditGrantRepo};
use super::ports::EntitlementSource;

#[cfg(test)]
mod test;

/// $10 of prepaid credit for a paid user, in customer cents.
pub const REWARD_CREDIT_CUSTOMER_CENTS: u32 = 1_000;
/// $10 more monthly free allowance, in provider-cost cents.
pub const FREE_BONUS_COST_CENTS: i64 = 1_000;
/// The most bonus a free user's monthly allowance can gain, in cost cents.
pub const FREE_BONUS_CAP_COST_CENTS: i64 = 5_000;

const REWARD_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6169_2d72_6577_6172_642d_6d61_6372_6f00);

/// A reward earned by `beneficiary` because someone joined or signed up.
#[derive(Debug, Clone)]
pub struct InviteReward {
    /// Who earns the reward: the inviter, link creator, or referrer.
    pub beneficiary: MacroUserIdStr<'static>,
    /// A stable key for the event that earned it, e.g. `team-invite:<id>`.
    pub event_key: String,
    /// Why it was granted; stored on the ledger entry.
    pub note: String,
}

impl InviteReward {
    /// The ledger id: the same event always books the same entry.
    pub fn id(&self) -> Uuid {
        Uuid::new_v5(&REWARD_ID_NAMESPACE, self.event_key.as_bytes())
    }
}

/// What a reward turned into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RewardOutcome {
    /// Prepaid credit booked on the beneficiary's payer.
    Credit,
    /// Monthly free allowance raised.
    FreeAllowance,
    /// Already booked for this event, or the beneficiary is on an unlimited plan.
    Nothing,
}

/// Persists free-allowance bonuses.
pub trait FreeAllowanceBonusRepo: Send + Sync + 'static {
    /// Book a bonus for `user`. Returns `false` when `id` was already booked.
    fn record_free_allowance_bonus(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        cost_cents: i64,
        note: &str,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Applies the cap to a user's booked bonus total.
pub fn capped_free_bonus_cents(booked_cost_cents: i64) -> i64 {
    booked_cost_cents.clamp(0, FREE_BONUS_CAP_COST_CENTS)
}

/// Grants [`InviteReward`]s.
pub struct InviteRewardService<Entitlements, Grants, Bonuses> {
    entitlements: Entitlements,
    grants: Grants,
    bonuses: Bonuses,
}

impl<Entitlements, Grants, Bonuses> InviteRewardService<Entitlements, Grants, Bonuses>
where
    Entitlements: EntitlementSource,
    Grants: CreditGrantRepo,
    Bonuses: FreeAllowanceBonusRepo,
{
    /// Build the service.
    pub fn new(entitlements: Entitlements, grants: Grants, bonuses: Bonuses) -> Self {
        Self {
            entitlements,
            grants,
            bonuses,
        }
    }

    /// Book `reward` in the form the beneficiary's plan can use.
    #[tracing::instrument(
        name = "ai_billing.invite_reward",
        skip_all,
        fields(beneficiary = %reward.beneficiary, reward_id = %reward.id(), outcome),
        err
    )]
    pub async fn reward(&self, reward: &InviteReward) -> Result<RewardOutcome> {
        let entitlement = self.entitlements.entitlement(&reward.beneficiary).await?;
        let outcome = if entitlement.unlimited {
            RewardOutcome::Nothing
        } else if entitlement.tier.is_paid() {
            let grant = CreditGrant {
                id: reward.id(),
                amount_cents: NonZeroU32::new(REWARD_CREDIT_CUSTOMER_CENTS)
                    .expect("the reward is positive"),
                note: reward.note.clone(),
            };
            if self
                .grants
                .record_credit_grant(&entitlement.payer, &grant)
                .await?
            {
                RewardOutcome::Credit
            } else {
                RewardOutcome::Nothing
            }
        } else if self
            .bonuses
            .record_free_allowance_bonus(
                &reward.beneficiary,
                reward.id(),
                FREE_BONUS_COST_CENTS,
                &reward.note,
            )
            .await?
        {
            RewardOutcome::FreeAllowance
        } else {
            RewardOutcome::Nothing
        };
        tracing::Span::current().record("outcome", tracing::field::debug(outcome));
        Ok(outcome)
    }
}
