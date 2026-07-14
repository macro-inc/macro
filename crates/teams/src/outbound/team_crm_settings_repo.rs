//! MacroDB-backed adapter for
//! [`crate::domain::team_crm_settings_repo::TeamCrmSettingsRepository`].
//!
//! Owns the `team_crm_settings` row for each team and the bulk
//! teardown of `crm_companies` (with FK cascade) when CRM is disabled.

use crate::domain::{model::TeamError, team_crm_settings_repo::TeamCrmSettingsRepository};
use sqlx::PgPool;

/// Macrodb-backed [`TeamCrmSettingsRepository`].
#[derive(Clone, Debug)]
pub struct TeamCrmSettingsRepositoryImpl {
    pool: PgPool,
}

impl TeamCrmSettingsRepositoryImpl {
    /// Creates a new repository wrapping the given macrodb pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl TeamCrmSettingsRepository for TeamCrmSettingsRepositoryImpl {
    #[tracing::instrument(skip(self), err)]
    async fn get_crm_enabled(&self, team_id: &uuid::Uuid) -> Result<bool, TeamError> {
        let enabled = sqlx::query_scalar!(
            r#"SELECT crm_enabled FROM team_crm_settings WHERE team_id = $1"#,
            team_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(enabled.unwrap_or(false))
    }

    #[tracing::instrument(skip(self), err)]
    async fn enable_crm(&self, team_id: &uuid::Uuid) -> Result<bool, TeamError> {
        // Upsert with a `DO UPDATE WHERE … IS DISTINCT FROM …` clause so
        // only one caller actually flips false → true. ON CONFLICT
        // serializes concurrent INSERTs on the same `team_id` via the PK
        // row lock; whichever transaction wins the lock first runs its
        // UPDATE (matched by the WHERE), later callers see the row
        // already at TRUE and the UPDATE is skipped. The CTE returns a
        // row only when an INSERT or matched-UPDATE happened, so
        // `EXISTS(...)` is true iff this call caused the state change.
        let changed = sqlx::query_scalar!(
            r#"
            WITH upsert AS (
                INSERT INTO team_crm_settings (team_id, crm_enabled)
                VALUES ($1, TRUE)
                ON CONFLICT (team_id) DO UPDATE
                SET crm_enabled = EXCLUDED.crm_enabled,
                    updated_at  = now()
                WHERE team_crm_settings.crm_enabled IS DISTINCT FROM EXCLUDED.crm_enabled
                RETURNING 1
            )
            SELECT EXISTS (SELECT 1 FROM upsert) AS "changed!"
            "#,
            team_id,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(changed)
    }

    #[tracing::instrument(skip(self), err)]
    async fn disable_crm_and_purge_data(&self, team_id: &uuid::Uuid) -> Result<(), TeamError> {
        let mut tx = self.pool.begin().await?;

        sqlx::query!(
            r#"
            INSERT INTO team_crm_settings (team_id, crm_enabled)
            VALUES ($1, FALSE)
            ON CONFLICT (team_id) DO UPDATE
            SET crm_enabled = FALSE,
                updated_at  = now()
            "#,
            team_id,
        )
        .execute(&mut *tx)
        .await?;

        // FK cascade clears crm_domains / crm_contacts /
        // crm_contact_sources owned by these companies.
        sqlx::query!(r#"DELETE FROM crm_companies WHERE team_id = $1"#, team_id,)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }
}
