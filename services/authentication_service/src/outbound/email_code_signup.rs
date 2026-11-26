//! What an email-code signup's first proof writes: the proof itself in
//! `macro_user_email_verification`, the domain team join, and the referral.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use referral::domain::{models::ReferralCode, ports::ReferralService};
use sqlx::PgPool;
use teams::domain::team_repo::TeamService;

use crate::service::user::email_code_signup::EmailCodeSignupPort;

/// The email-code signup port over MacroDB and the teams and referral services.
pub(crate) struct EmailCodeSignupEffects<'a, T, R> {
    pub pool: &'a PgPool,
    pub teams: &'a T,
    pub referrals: &'a R,
}

/// Marks the account's address verified. True only when this call changed it:
/// the row must belong to the account and still be unverified.
#[tracing::instrument(name = "auth.email_code_signup.claim_proof", skip_all, err)]
pub(crate) async fn claim_first_proof(
    pool: &PgPool,
    fusionauth_user_id: &str,
    email: &str,
) -> anyhow::Result<bool> {
    let macro_user_id = macro_uuid::string_to_uuid(fusionauth_user_id)?;
    let claimed = sqlx::query!(
        r#"
        UPDATE "macro_user_email_verification"
        SET "is_verified" = true
        WHERE "email" = $1 AND "macro_user_id" = $2 AND NOT "is_verified"
        "#,
        email,
        &macro_user_id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(claimed == 1)
}

impl<T, R> EmailCodeSignupPort for EmailCodeSignupEffects<'_, T, R>
where
    T: TeamService + Sync,
    R: ReferralService + Sync,
{
    async fn claim_first_proof(
        &self,
        fusionauth_user_id: &str,
        email: &str,
    ) -> anyhow::Result<bool> {
        claim_first_proof(self.pool, fusionauth_user_id, email).await
    }

    async fn join_domain_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<Option<uuid::Uuid>> {
        let member = self.teams.try_join_team_by_domain(user_id).await?;
        Ok(member.map(|member| member.team_id))
    }

    async fn track_referral(
        &self,
        user_id: &MacroUserIdStr<'_>,
        referral_code: &str,
    ) -> anyhow::Result<()> {
        self.referrals
            .track_referral(user_id, &ReferralCode(referral_code.to_owned()))
            .await?;
        Ok(())
    }
}
