//! The model configuration each paired runtime last reported, in Postgres.

use agent_client_protocol::schema::v1::SessionConfigOption;
use agent_harness::domain::model_load::{KnownMacrodModels, KnownModels};
use harness_id::HarnessId;
use sqlx::PgPool;
use sqlx::types::Json;

/// [`KnownMacrodModels`] in `harness_known_models`.
#[derive(Clone)]
pub struct PgKnownModels {
    pool: PgPool,
}

impl PgKnownModels {
    /// Build the store over the shared pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl KnownMacrodModels for PgKnownModels {
    async fn last_known(&self, harness: HarnessId) -> Result<Option<KnownModels>, String> {
        let row = sqlx::query!(
            r#"
            SELECT options AS "options: Json<Vec<SessionConfigOption>>", observed_at
            FROM harness_known_models
            WHERE harness_id = $1
            "#,
            harness.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok(row.map(|row| KnownModels {
            options: row.options.0,
            observed_at: row.observed_at,
        }))
    }

    async fn remember(
        &self,
        harness: HarnessId,
        options: &[SessionConfigOption],
    ) -> Result<(), String> {
        sqlx::query!(
            r#"
            INSERT INTO harness_known_models (harness_id, options, observed_at)
            VALUES ($1, $2, now())
            ON CONFLICT (harness_id)
            DO UPDATE SET options = EXCLUDED.options, observed_at = EXCLUDED.observed_at
            "#,
            harness.as_uuid(),
            Json(options) as _,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok(())
    }
}
