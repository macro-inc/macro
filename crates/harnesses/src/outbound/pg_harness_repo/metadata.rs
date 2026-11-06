//! Harness capability and Claude mode persistence.

use super::*;

impl PgHarnessRepo {
    pub(super) async fn set_capabilities_inner(
        &self,
        harness_id: HarnessId,
        capabilities: HarnessCapabilities,
    ) -> Result<bool, HarnessPersistenceError> {
        let updated = sqlx::query!(
            r#"
            UPDATE harnesses
            SET capabilities = $2, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
            Json(capabilities) as _,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to set harness capabilities")
                    .into_dynamic(),
            )
        })?;
        Ok(updated.rows_affected() == 1)
    }

    pub(super) async fn set_claude_mode_inner(
        &self,
        harness_id: HarnessId,
        mode: ClaudeMode,
    ) -> Result<bool, HarnessPersistenceError> {
        let updated = sqlx::query!(
            r#"
            UPDATE harnesses
            SET claude_mode = $2, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
            mode.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to set harness claude mode")
                    .into_dynamic(),
            )
        })?;
        Ok(updated.rows_affected() == 1)
    }
}
