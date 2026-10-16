//! Postgres implementation of [`OnboardingRepo`].

use crate::domain::models::{OnboardingRow, OnboardingStatus};
use crate::domain::ports::{OnboardingRepo, Result};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::str::FromStr;

#[cfg(test)]
mod test;

/// Postgres-backed onboarding repository (MacroDB).
#[derive(Clone)]
pub struct PgOnboardingRepo {
    pool: PgPool,
}

impl PgOnboardingRepo {
    /// Build the repository on the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct OnboardingDbRow {
    status: String,
    skipped: bool,
    started_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    agent_led_at: Option<DateTime<Utc>>,
    agent_client: Option<String>,
}

impl TryFrom<OnboardingDbRow> for OnboardingRow {
    type Error = crate::domain::ports::OnboardingError;

    fn try_from(row: OnboardingDbRow) -> Result<OnboardingRow> {
        let status = OnboardingStatus::from_str(&row.status)
            .map_err(|_| anyhow::anyhow!("unknown onboarding status: {}", row.status))?;
        Ok(OnboardingRow {
            status,
            skipped: row.skipped,
            started_at: row.started_at,
            completed_at: row.completed_at,
            agent_led_at: row.agent_led_at,
            agent_client: row.agent_client,
        })
    }
}

impl OnboardingRepo for PgOnboardingRepo {
    #[tracing::instrument(skip(self), err)]
    async fn ensure_row(&self, user: &MacroUserIdStr<'static>) -> Result<OnboardingRow> {
        // One round trip: insert-or-noop, returning the current row either
        // way (the no-op DO UPDATE makes RETURNING yield the existing row).
        let row = sqlx::query_as!(
            OnboardingDbRow,
            r#"
            INSERT INTO user_onboarding (user_id) VALUES ($1)
            ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
            RETURNING status, skipped, started_at, completed_at, agent_led_at, agent_client
            "#,
            user.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        row.try_into()
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_row(&self, user: &MacroUserIdStr<'static>) -> Result<Option<OnboardingRow>> {
        let row = sqlx::query_as!(
            OnboardingDbRow,
            r#"
            SELECT status, skipped, started_at, completed_at, agent_led_at, agent_client
            FROM user_onboarding
            WHERE user_id = $1
            "#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(TryInto::try_into).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn complete(
        &self,
        user: &MacroUserIdStr<'static>,
        skipped: bool,
    ) -> Result<OnboardingRow> {
        let row = sqlx::query_as!(
            OnboardingDbRow,
            r#"
            INSERT INTO user_onboarding (user_id, status, skipped, completed_at)
            VALUES ($1, 'completed', $2, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET status = 'completed',
                skipped = CASE
                    WHEN user_onboarding.status = 'completed' THEN user_onboarding.skipped
                    ELSE EXCLUDED.skipped
                END,
                completed_at = COALESCE(user_onboarding.completed_at, EXCLUDED.completed_at),
                updated_at = NOW()
            RETURNING status, skipped, started_at, completed_at, agent_led_at, agent_client
            "#,
            user.as_ref(),
            skipped,
        )
        .fetch_one(&self.pool)
        .await?;
        row.try_into()
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_agent_led(
        &self,
        user: &MacroUserIdStr<'static>,
        client: Option<&str>,
    ) -> Result<Option<OnboardingRow>> {
        // The conflict branch only fires for rows that never finished the web
        // flow (or are already agent-led), so a web-onboarded account returns
        // no row and is left exactly as it was.
        let row = sqlx::query_as!(
            OnboardingDbRow,
            r#"
            INSERT INTO user_onboarding
                (user_id, status, skipped, completed_at, agent_led_at, agent_client)
            VALUES ($1, 'completed', FALSE, NOW(), NOW(), $2)
            ON CONFLICT (user_id) DO UPDATE
            SET status = 'completed',
                completed_at = COALESCE(user_onboarding.completed_at, EXCLUDED.completed_at),
                agent_led_at = COALESCE(user_onboarding.agent_led_at, EXCLUDED.agent_led_at),
                agent_client = COALESCE(user_onboarding.agent_client, EXCLUDED.agent_client),
                updated_at = NOW()
            WHERE user_onboarding.status = 'active'
               OR user_onboarding.agent_led_at IS NOT NULL
            RETURNING status, skipped, started_at, completed_at, agent_led_at, agent_client
            "#,
            user.as_ref(),
            client,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(TryInto::try_into).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_row(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        sqlx::query!(
            r#"
            DELETE FROM user_onboarding
            WHERE user_id = $1
            "#,
            user.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// The domain error stays sqlx-free; this adapter owns the mapping so `?`
// works on sqlx results throughout the crate's outbound code. The raw sqlx
// error travels inside the report.
impl From<sqlx::Error> for crate::domain::ports::OnboardingError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(rootcause::report!(e).into_dynamic())
    }
}
