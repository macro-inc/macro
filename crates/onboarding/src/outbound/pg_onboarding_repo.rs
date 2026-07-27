//! Postgres implementation of [`OnboardingRepo`].

use crate::domain::models::{OnboardingRow, OnboardingStatus};
use crate::domain::ports::{OnboardingRepo, Result};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::str::FromStr;

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
            RETURNING status, skipped, started_at, completed_at
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
            SELECT status, skipped, started_at, completed_at
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
            RETURNING status, skipped, started_at, completed_at
            "#,
            user.as_ref(),
            skipped,
        )
        .fetch_one(&self.pool)
        .await?;
        row.try_into()
    }
}
