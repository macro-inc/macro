//! Referral service implementation.

#[cfg(test)]
mod test;

use std::{collections::HashSet, ops::Deref, time::Duration};

use macro_user_id::{
    email::EmailStr,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_entity::EntityType;
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult, domain::ports::RateLimitService};
use rootcause::compat::boxed_error::IntoBoxedError;

use crate::domain::{
    models::{InviteToMacro, ReferralCode, ReferralError},
    ports::{DiscountClient, ReferralRepo, ReferralService},
};

/// The concrete referral service implementation.
pub struct ReferralServiceImpl<R, Dc, Rl, N> {
    ///  referral repo
    pub repo: R,
    /// discount client
    pub discount_client: Dc,
    /// rate limiter service
    pub rate_limit: Rl,
    /// the notification sender
    pub notification_ingress: N,
}

impl<
    R: ReferralRepo,
    Dc: DiscountClient,
    Rl: RateLimitService,
    // the constructor for this is Arc<NI> so we use a different bound here
    N: Deref<Target = NI> + Send + Sync + 'static,
    NI: NotificationIngress,
> ReferralServiceImpl<R, Dc, Rl, N>
{
    async fn send_referral_invite_inner(
        &self,
        sending_user: MacroUserIdStr<'_>,
        recipient: EmailStr<'static>,
    ) -> Result<(), ReferralError> {
        let referral_code = self.get_referral_code_for_user(&sending_user.0).await?;

        let notification = InviteToMacro {
            recipient_email: recipient.clone(),
            referral_code,
        };

        let _res = self
            .notification_ingress
            .send_notification(
                SendNotificationRequestBuilder {
                    notification_entity: EntityType::User
                        .with_entity_string(sending_user.as_ref().to_string()),
                    notification,
                    sender_id: Some(sending_user),
                    recipient_ids: HashSet::from([MacroUserIdStr::try_from_email(
                        recipient.0.as_ref(),
                    )
                    .map_err(anyhow::Error::from)?]),
                }
                .into_request()
                .with_email(),
            )
            .await
            .map_err(|r| r.into_boxed_error())
            .map_err(anyhow::Error::from_boxed)?;

        Ok(())
    }
}

impl<
    R: ReferralRepo,
    Dc: DiscountClient,
    Rl: RateLimitService,
    // the constructor for this is Arc<NI> so we use a different bound here
    N: Deref<Target = NI> + Send + Sync + 'static,
    NI: NotificationIngress,
> ReferralService for ReferralServiceImpl<R, Dc, Rl, N>
{
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
            .map_err(|e| ReferralError::Internal(e.into()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_referred_by(
        &self,
        referred_user_id: &uuid::Uuid,
    ) -> Result<Option<ReferralCode>, ReferralError> {
        self.repo
            .get_referred_by(referred_user_id)
            .await
            .map_err(|e| ReferralError::Internal(e.into()))
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

    async fn send_referral_invite(
        &self,
        sending_user: MacroUserIdStr<'_>,
        recipient: EmailStr<'static>,
    ) -> Result<(), ReferralError> {
        let user_rate_limit = RateLimitKey::builder(&"user_sent_invites")
            .append(&sending_user.as_ref())
            .finish();
        let ticket = self
            .rate_limit
            .check_rate_limit(user_rate_limit, RATE_LIMIT_CONFIG_PER_USER.clone())
            .await
            .map_err(|r| r.into_boxed_error())
            .map_err(anyhow::Error::from_boxed)?;

        if let RateLimitResult::Exceeded(err) = &*ticket {
            return Err(ReferralError::RateLimitExceeded(err.clone()));
        }

        let () = self
            .send_referral_invite_inner(sending_user, recipient)
            .await?;

        let _ = self.rate_limit.increment_ticket(ticket).await;

        Ok(())
    }
}

/// The fixed window rate limit config for the number of invites a user can send to others
const RATE_LIMIT_CONFIG_PER_USER: RateLimitConfig = RateLimitConfig {
    max_count: 50,
    window: Duration::from_mins(60),
};
