//! Which Macro account a Stripe customer belongs to, and the account's
//! `has_trialed` flag.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Account lookups by Stripe customer.
#[derive(Debug, Clone)]
pub struct PgStripeIdentity {
    pool: PgPool,
}

impl PgStripeIdentity {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The account whose Stripe customer this is (`User.stripeCustomerId`
    /// is unique).
    #[tracing::instrument(skip(self), err)]
    pub async fn user_for_customer(
        &self,
        customer: &stripe::CustomerId,
    ) -> anyhow::Result<Option<MacroUserIdStr<'static>>> {
        let id = sqlx::query_scalar!(
            r#"SELECT id FROM "User" WHERE "stripeCustomerId" = $1"#,
            customer.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?;
        id.map(|id| {
            MacroUserIdStr::try_from(id)
                .map_err(|error| anyhow::anyhow!("stored user id is invalid: {error:?}"))
        })
        .transpose()
    }

    /// Whether the account exists.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn user_exists(&self, user: &MacroUserIdStr<'_>) -> anyhow::Result<bool> {
        Ok(sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM "User" WHERE id = $1) AS "exists!""#,
            user.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?)
    }

    /// Records that the account has used its trial.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn mark_has_trialed(&self, user: &MacroUserIdStr<'_>) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            UPDATE macro_user SET has_trialed = true
            FROM "User" u
            WHERE u.macro_user_id = macro_user.id AND u.id = $1
            "#,
            user.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
