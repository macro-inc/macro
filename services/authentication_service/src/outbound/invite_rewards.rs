//! Pays team-invite and referral rewards through AI billing.

use std::sync::Arc;

use ai_billing::domain::{
    CreditGrantRepo, FreeAllowanceBonusRepo, InviteReward, InviteRewardService,
    ports::EntitlementSource,
};
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::invite_rewards::{InviteRewardEvent, InviteRewardFuture, InviteRewarder};

/// Books invite and referral rewards with [`InviteRewardService`].
pub(crate) struct BillingInviteRewards<E, G, B> {
    service: Arc<InviteRewardService<E, G, B>>,
}

impl<E, G, B> BillingInviteRewards<E, G, B> {
    pub(crate) fn new(service: InviteRewardService<E, G, B>) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

impl<E, G, B> Clone for BillingInviteRewards<E, G, B> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<E, G, B> std::fmt::Debug for BillingInviteRewards<E, G, B> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BillingInviteRewards")
            .finish_non_exhaustive()
    }
}

impl<E, G, B> BillingInviteRewards<E, G, B>
where
    E: EntitlementSource,
    G: CreditGrantRepo,
    B: FreeAllowanceBonusRepo,
{
    async fn reward(
        &self,
        beneficiary: MacroUserIdStr<'static>,
        joined: &MacroUserIdStr<'_>,
        event_key: String,
        why: &str,
    ) -> anyhow::Result<()> {
        let reward = InviteReward {
            note: format!("{why}: {joined} ({event_key})"),
            beneficiary,
            event_key,
        };
        self.service
            .reward(&reward)
            .await
            .map_err(|error| anyhow::anyhow!(error))?;
        Ok(())
    }
}

impl<E, G, B> InviteRewarder for BillingInviteRewards<E, G, B>
where
    E: EntitlementSource,
    G: CreditGrantRepo,
    B: FreeAllowanceBonusRepo,
{
    fn reward_inviter(&self, event: InviteRewardEvent) -> InviteRewardFuture<'_> {
        Box::pin(async move {
            self.reward(event.inviter, &event.joined, event.event_key, "team join")
                .await
        })
    }
}

impl<E, G, B> referral::domain::ports::ReferralRewarder for BillingInviteRewards<E, G, B>
where
    E: EntitlementSource,
    G: CreditGrantRepo,
    B: FreeAllowanceBonusRepo,
{
    async fn reward_referrer(
        &self,
        referrer: MacroUserIdStr<'static>,
        referred: MacroUserIdStr<'static>,
        event_key: String,
    ) -> anyhow::Result<()> {
        self.reward(referrer, &referred, event_key, "referral signup")
            .await
    }
}
