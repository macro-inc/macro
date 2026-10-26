//! PostgreSQL implementation of the [`ReferralRepo`] port.

#[cfg(test)]
mod test;

use macro_user_id::{
    cowlike::CowLike,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use macro_uuid::ShortUuidConverter;
use sqlx::PgPool;

use crate::domain::{
    models::{ReferralCode, TrackedReferral, referral_code_to_uuid},
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
    ) -> Result<Option<TrackedReferral>, Self::Err> {
        let referrer_id =
            referral_code_to_uuid(referral_code).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

        // The referrer must exist; their Macro id is who earns the reward.
        let referrer = sqlx::query_scalar!(
            r#"SELECT id FROM "User" WHERE macro_user_id = $1"#,
            &referrer_id
        )
        .fetch_one(&self.pool)
        .await?;
        let referrer = MacroUserIdStr::parse_from_str(&referrer)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
            .into_owned();

        let referred_id = sqlx::query!(
            r#"SELECT macro_user_id FROM "User" WHERE id = $1"#,
            referred_user_id.as_ref()
        )
        .map(|s| s.macro_user_id)
        .fetch_one(&self.pool)
        .await?;

        let tracking_id = macro_uuid::generate_uuid_v7();
        // A user is referred at most once (unique referred_id), so a repeated
        // signup or login with a code records nothing.
        let inserted = sqlx::query_scalar!(
            r#"
            INSERT INTO referral_tracking (id, referrer_id, referred_id, status, created_at)
            VALUES ($1, $2, $3, 'incomplete', NOW())
            ON CONFLICT (referred_id) DO NOTHING
            RETURNING id
            "#,
            &tracking_id,
            &referrer_id,
            &referred_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(inserted.map(|tracking_id| TrackedReferral {
            tracking_id,
            referrer,
        }))
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
            WHERE referrer_id = $1 AND referred_id = $2 AND status != 'complete'"#,
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
    async fn get_sender_info<'a>(
        &self,
        user_id: &MacroUserId<Lowercase<'a>>,
    ) -> Result<(Option<String>, Option<String>), Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT
                CASE
                    WHEN mui.profile_picture IS NOT NULL AND mui.profile_picture != ''
                    THEN mui.profile_picture
                    ELSE NULL
                END AS "profile_picture_url?: String",
                NULLIF(TRIM(CONCAT_WS(' ', NULLIF(first_name, 'N/A'), NULLIF(last_name, 'N/A'))), '') AS "display_name?: String"
            FROM macro_user_info mui
            JOIN "User" u ON u.macro_user_id = mui.macro_user_id
            WHERE u.id = $1
            "#,
            user_id.as_ref()
        )
        .fetch_optional(&self.pool)
        .await?
        .map(|r| (r.profile_picture_url, r.display_name));

        Ok(row.unwrap_or((None, None)))
    }
}
