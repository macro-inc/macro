//! PostgreSQL implementation of the [`ReferralRepo`] port.

#[cfg(test)]
mod test;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use macro_uuid::ShortUuidConverter;
use sqlx::PgPool;

use crate::domain::{
    models::{ReferralCode, referral_code_to_uuid},
    ports::ReferralRepo,
};

/// PostgreSQL-backed referral repo
#[derive(Clone)]
pub struct PgReferralRepo {
    /// The postgres pool
    pool: PgPool,
    /// Short uuid converter
    short_uuid_converter: ShortUuidConverter,
}
impl PgReferralRepo {
    /// Create a new repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            short_uuid_converter: ShortUuidConverter::default(),
        }
    }
}

impl ReferralRepo for PgReferralRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn get_referral_code_for_user<'a>(
        &self,
        user_id: &MacroUserId<Lowercase<'a>>,
    ) -> Result<ReferralCode, Self::Err> {
        let fusion_user_id = sqlx::query!(
            r#"
                SELECT macro_user_id FROM "User"
                WHERE id = $1
            "#,
            user_id.as_ref()
        )
        .map(|r| r.macro_user_id)
        .fetch_one(&self.pool)
        .await?;

        // convert to referral code
        Ok(ReferralCode(
            self.short_uuid_converter.from_uuid(&fusion_user_id),
        ))
    }

    #[tracing::instrument(skip(self), err)]
    async fn track_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> Result<(), Self::Err> {
        let referrer_id =
            referral_code_to_uuid(referral_code).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

        // make sure this user exists
        sqlx::query!(
            "SELECT 1 as exists FROM macro_user WHERE id = $1",
            &referrer_id
        )
        .fetch_one(&self.pool)
        .await?;

        let referred_id = sqlx::query!(
            r#"SELECT macro_user_id FROM "User" WHERE id = $1"#,
            referred_user_id.as_ref()
        )
        .map(|s| s.macro_user_id)
        .fetch_one(&self.pool)
        .await?;

        let tracking_id = macro_uuid::generate_uuid_v7();
        sqlx::query!("INSERT INTO referral_tracking (id, referrer_id, referred_id, status, created_at) VALUES ($1, $2, $3, 'incomplete', NOW())", &tracking_id, &referrer_id, &referred_id).execute(&self.pool).await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_referred_by(
        &self,
        referred_user_id: &uuid::Uuid,
    ) -> Result<Option<ReferralCode>, Self::Err> {
        let referrer_id: Option<uuid::Uuid> = sqlx::query!(
            "SELECT referrer_id FROM referral_tracking WHERE referred_id = $1",
            referred_user_id
        )
        .map(|r| r.referrer_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(referrer_id.map(|id| ReferralCode(self.short_uuid_converter.from_uuid(&id))))
    }

    #[tracing::instrument(skip(self), err)]
    async fn complete_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> Result<(), Self::Err> {
        let referrer_id =
            referral_code_to_uuid(referral_code).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

        // make sure this user exists
        sqlx::query!(
            "SELECT 1 as exists FROM macro_user WHERE id = $1",
            &referrer_id
        )
        .fetch_one(&self.pool)
        .await?;

        let referred_id = sqlx::query!(
            r#"SELECT macro_user_id FROM "User" WHERE id = $1"#,
            referred_user_id.as_ref()
        )
        .map(|s| s.macro_user_id)
        .fetch_one(&self.pool)
        .await?;

        let result = sqlx::query!(
            r#"
            UPDATE referral_tracking
            SET status = 'complete'
            WHERE referrer_id = $1 and referred_id = $2"#,
            &referrer_id,
            &referred_id
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_referrers_customer_id(
        &self,
        referral_code: &ReferralCode,
    ) -> Result<String, Self::Err> {
        let fusion_user_id =
            referral_code_to_uuid(referral_code).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

        sqlx::query!(
            r#"
            SELECT stripe_customer_id FROM macro_user
            WHERE id = $1
        "#,
            fusion_user_id,
        )
        .map(|s| s.stripe_customer_id)
        .fetch_one(&self.pool)
        .await
    }
}
