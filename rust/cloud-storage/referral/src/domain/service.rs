//! Referral service implementation.

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

use crate::domain::{
    models::{ReferralCode, ReferralError},
    ports::{DiscountClient, ReferralRepo, ReferralService},
};

/// The concrete referral service implementation.
pub struct ReferralServiceImpl<R: ReferralRepo, Dc: DiscountClient> {
    ///  referral repo
    repo: R,
    /// discount client
    discount_client: Dc,
}

impl<R: ReferralRepo, Dc: DiscountClient> ReferralServiceImpl<R, Dc> {
    /// Create a new referral service.
    pub fn new(repo: R, discount_client: Dc) -> Self {
        Self {
            repo,
            discount_client,
        }
    }
}

impl<R: ReferralRepo, Dc: DiscountClient> ReferralService for ReferralServiceImpl<R, Dc> {
    #[tracing::instrument(skip(self), err)]
    async fn get_referral_code_for_user<'a>(
        &self,
        user_id: &MacroUserId<Lowercase<'a>>,
    ) -> Result<ReferralCode, ReferralError> {
        self.repo
            .get_referral_code_for_user(user_id)
            .await
            .map_err(|e| ReferralError::Internal(e.into()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn track_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> Result<(), ReferralError> {
        self.repo
            .track_referral(referred_user_id, referral_code)
            .await
            .map_err(|e| ReferralError::Internal(e.into()))?;
        todo!()
    }

    #[tracing::instrument(skip(self), err)]
    async fn process_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> Result<(), ReferralError> {
        // NOTE: This will error if the referral code is invalid and we cannot find a
        // user from the referral code
        let customer_id = self
            .repo
            .get_referrers_customer_id(referral_code)
            .await
            .map_err(|e| ReferralError::Internal(e.into()))?;

        self.repo
            .complete_referral(referred_user_id, referral_code)
            .await
            .map_err(|e| ReferralError::Internal(e.into()))?;

        self.discount_client
            .apply_discount(&customer_id)
            .await
            .map_err(|e| ReferralError::Internal(e.into()))?;

        Ok(())
    }
}
