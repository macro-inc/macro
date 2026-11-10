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
            SET capabilities = $2, capabilities_reported_at = now(), updated_at = now()
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
        change: ClaudeModeChange,
    ) -> Result<bool, HarnessPersistenceError> {
        let signed_in_by = match &change {
            ClaudeModeChange::SignedIn { signed_in_by } => Some(signed_in_by.as_ref()),
            ClaudeModeChange::SignedOut => None,
        };
        let updated = sqlx::query!(
            r#"
            UPDATE harnesses
            SET claude_mode = $2,
                claude_signed_in_by = $3,
                claude_signed_in_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,
                updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
            change.mode().as_str(),
            signed_in_by,
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
