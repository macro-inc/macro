//! How routines' code was brought to new SDKs, in `scheduled_action_code_upgrade`.

use anyhow::{Context, Result};
use macro_uuid::Uuid;
use routine_program::SdkFingerprint;
use serde_json::Value;
use sqlx::PgPool;

use crate::domain::code_upgrade::{CodeUpgrade, UpgradeOutcome};
use crate::domain::models::ScheduledAction;
use crate::domain::ports::CodeUpgrades;

#[cfg(test)]
mod test;

/// A rewrite claimed this long ago and still running belonged to a process
/// that stopped; another run may take it over.
const ABANDONED_AFTER_MINUTES: i32 = 10;

pub struct PgCodeUpgrades {
    pool: PgPool,
}

impl PgCodeUpgrades {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn identity(action: &ScheduledAction) -> Result<(Uuid, i64)> {
    Ok((
        action.id.context("persisted action required")?,
        action.configuration_revision.get(),
    ))
}

fn from_sdk(action: &ScheduledAction) -> Option<String> {
    action
        .task
        .get("sdk")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

impl CodeUpgrades for PgCodeUpgrades {
    async fn record_checked(&self, action: &ScheduledAction, sdk: &SdkFingerprint) -> Result<()> {
        let (id, revision) = identity(action)?;
        let mut transaction = self.pool.begin().await?;
        // Bookkeeping, not configuration: the revision stays, so queued
        // event runs aren't superseded.
        let updated = sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET task = jsonb_set(task, '{sdk}', to_jsonb($3::text))
            WHERE id = $1 AND configuration_revision = $2
            "#,
            id,
            revision,
            sdk.as_str(),
        )
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() == 1 {
            sqlx::query!(
                r#"
                INSERT INTO scheduled_action_code_upgrade
                    (id, action_id, from_sdk, to_sdk, outcome, previous_task)
                VALUES ($1, $2, $3, $4, 'checked', $5)
                ON CONFLICT (action_id, to_sdk) DO NOTHING
                "#,
                macro_uuid::generate_uuid_v7(),
                id,
                from_sdk(action),
                sdk.as_str(),
                action.task,
            )
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn claim_rewrite(&self, action: &ScheduledAction, sdk: &SdkFingerprint) -> Result<bool> {
        let (id, _) = identity(action)?;
        let claimed = sqlx::query_scalar!(
            r#"
            INSERT INTO scheduled_action_code_upgrade
                (id, action_id, from_sdk, to_sdk, outcome, previous_task)
            VALUES ($1, $2, $3, $4, 'running', $5)
            ON CONFLICT (action_id, to_sdk) DO UPDATE
            SET outcome = 'running', previous_task = EXCLUDED.previous_task,
                from_sdk = EXCLUDED.from_sdk, task = NULL, reason = NULL, updated_at = now()
            WHERE scheduled_action_code_upgrade.outcome = 'running'
              AND scheduled_action_code_upgrade.updated_at
                  < now() - make_interval(mins => $6::int)
            RETURNING id
            "#,
            macro_uuid::generate_uuid_v7(),
            id,
            from_sdk(action),
            sdk.as_str(),
            action.task,
            ABANDONED_AFTER_MINUTES,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(claimed.is_some())
    }

    async fn save_rewrite(
        &self,
        action: &ScheduledAction,
        sdk: &SdkFingerprint,
        task: &Value,
    ) -> Result<()> {
        let (id, revision) = identity(action)?;
        let mut transaction = self.pool.begin().await?;
        // Equivalent code under the same configuration: the revision stays,
        // and an edit the owner saved meanwhile wins.
        sqlx::query!(
            r#"
            UPDATE scheduled_action SET task = $3
            WHERE id = $1 AND configuration_revision = $2
            "#,
            id,
            revision,
            task,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            UPDATE scheduled_action_code_upgrade
            SET outcome = 'rewritten', task = $3, updated_at = now()
            WHERE action_id = $1 AND to_sdk = $2
            "#,
            id,
            sdk.as_str(),
            task,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn needs_update(
        &self,
        action: &ScheduledAction,
        sdk: &SdkFingerprint,
        reason: &str,
        proposal: Option<&Value>,
    ) -> Result<()> {
        let (id, revision) = identity(action)?;
        let mut transaction = self.pool.begin().await?;
        sqlx::query!(
            r#"
            UPDATE scheduled_action SET enabled = false, updated_at = now()
            WHERE id = $1 AND configuration_revision = $2
            "#,
            id,
            revision,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            UPDATE scheduled_action_code_upgrade
            SET outcome = 'needs_update', reason = $3, task = $4, updated_at = now()
            WHERE action_id = $1 AND to_sdk = $2
            "#,
            id,
            sdk.as_str(),
            reason,
            proposal,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn list_upgrades(&self, action_id: Uuid) -> Result<Vec<CodeUpgrade>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, from_sdk, to_sdk, outcome, reason, previous_task, task,
                   created_at, updated_at
            FROM scheduled_action_code_upgrade
            WHERE action_id = $1
            ORDER BY created_at DESC, id DESC
            "#,
            action_id,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(CodeUpgrade {
                    id: row.id,
                    from_sdk: row.from_sdk,
                    to_sdk: row.to_sdk,
                    outcome: match row.outcome.as_str() {
                        "running" => UpgradeOutcome::Running,
                        "checked" => UpgradeOutcome::Checked,
                        "rewritten" => UpgradeOutcome::Rewritten,
                        "needs_update" => UpgradeOutcome::NeedsUpdate,
                        other => anyhow::bail!("unknown upgrade outcome {other}"),
                    },
                    reason: row.reason,
                    previous_task: row.previous_task,
                    task: row.task,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                })
            })
            .collect()
    }
}
