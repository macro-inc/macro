//! Referral service implementation.

#[cfg(test)]
mod test;

use std::{collections::HashSet, ops::Deref};

use macro_user_id::{
    email::{EmailStr, ReadEmailParts},
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_entity::EntityType;
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use rootcause::compat::boxed_error::IntoBoxedError;

use crate::domain::{
    models::{InviteToMacro, ReferralCode, ReferralError},
    ports::{DiscountClient, ReferralRepo, ReferralService},
};

/// The concrete referral service implementation.
pub struct ReferralServiceImpl<R, Dc, N> {
    ///  referral repo
    pub repo: R,
    /// discount client
    pub discount_client: Dc,
    /// the notification sender
    pub notification_ingress: N,
}

impl<
    R: ReferralRepo,
    Dc: DiscountClient,
    // the constructor for this is Arc<NI> so we use a different bound here
    N: Deref<Target = NI> + Send + Sync + 'static,
    NI: NotificationIngress,
> ReferralService for ReferralServiceImpl<R, Dc, N>
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

    #[tracing::instrument(skip(self), err)]
    async fn send_referral_invite(
        &self,
        sending_user: MacroUserIdStr<'_>,
        recipient: EmailStr<'static>,
    ) -> Result<(), ReferralError> {
        let referral_code = self.get_referral_code_for_user(&sending_user.0).await?;

        let (sender_profile_picture_url, sender_name) = self
            .repo
            .get_sender_info(&sending_user.0)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!(error=?e, "failed to fetch sender info");
                (None, None)
            });

        let sender_email = Some(sending_user.email_part().email_str().to_string());

        let notification = InviteToMacro {
            recipient_email: recipient.clone(),
            referral_code,
            sender_profile_picture_url,
            sender_name,
            sender_email,
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
