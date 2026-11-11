use crate::audit::{self, AuditRecord, AuditResult};
use crate::domain::{
    EnterpriseError, EnterpriseRepository, Result, RuntimePreset, RuntimePresetAllowlist,
    VerifiedRoxIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::str::FromStr;
use uuid::Uuid;

/// MacroDB adapter for the enterprise-owned tables.
#[derive(Clone)]
pub struct PgEnterpriseRepository {
    pool: PgPool,
}

impl PgEnterpriseRepository {
    /// Construct the adapter over MacroDB.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn storage(error: sqlx::Error) -> EnterpriseError {
    EnterpriseError::Storage(anyhow::Error::new(error))
}

impl EnterpriseRepository for PgEnterpriseRepository {
    async fn bind_verified(
        &self,
        macro_user_id: &MacroUserIdStr<'_>,
        identity: VerifiedRoxIdentity,
    ) -> Result<()> {
        let written = sqlx::query!(
            r#"
            INSERT INTO rox_identity_binding (macro_user_id, rox_account_id, handle)
            VALUES ($1, $2, $3)
            ON CONFLICT (macro_user_id) DO UPDATE SET bound_at = NOW()
            WHERE rox_identity_binding.rox_account_id = EXCLUDED.rox_account_id
              AND rox_identity_binding.handle = EXCLUDED.handle
            "#,
            macro_user_id.as_ref(),
            identity.account_id(),
            identity.handle(),
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        if written.rows_affected() != 1 {
            return Err(EnterpriseError::BindingConflict);
        }
        Ok(())
    }

    async fn commit_member_state(
        &self,
        actor: &MacroUserIdStr<'_>,
        member: &MacroUserIdStr<'_>,
        disabled: bool,
        result: AuditResult,
    ) -> Result<()> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        if disabled {
            sqlx::query!(
                r#"
                INSERT INTO enterprise_member_state (macro_user_id, disabled_at)
                VALUES ($1, NOW())
                ON CONFLICT (macro_user_id) DO UPDATE SET disabled_at = NOW()
                "#,
                member.as_ref(),
            )
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        } else {
            sqlx::query!(
                r#"
                INSERT INTO enterprise_member_state (macro_user_id, disabled_at)
                VALUES ($1, NULL)
                ON CONFLICT (macro_user_id) DO UPDATE SET disabled_at = NULL
                "#,
                member.as_ref(),
            )
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        }

        let action = if disabled {
            crate::audit::AuditAction::MemberDisable
        } else {
            crate::audit::AuditAction::MemberEnable
        };
        audit::append(
            &mut transaction,
            &AuditRecord::new(actor, action, member.as_ref(), result),
        )
        .await
        .map_err(storage)?;
        transaction.commit().await.map_err(storage)
    }

    async fn member_disabled(&self, member: &MacroUserIdStr<'_>) -> Result<bool> {
        sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM enterprise_member_state
                WHERE macro_user_id = $1 AND disabled_at IS NOT NULL
            ) AS "disabled!"
            "#,
            member.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(storage)
    }

    async fn set_runtime_allowlist(
        &self,
        team_id: Uuid,
        allowlist: Option<&RuntimePresetAllowlist>,
    ) -> Result<()> {
        match allowlist {
            Some(allowlist) => {
                let preset_ids: Vec<String> = allowlist
                    .preset_ids
                    .iter()
                    .map(|preset| preset.as_ref().to_owned())
                    .collect();
                sqlx::query!(
                    r#"
                    INSERT INTO team_runtime_preset_allowlist (team_id, preset_ids)
                    VALUES ($1, $2)
                    ON CONFLICT (team_id) DO UPDATE SET preset_ids = EXCLUDED.preset_ids
                    "#,
                    team_id,
                    &preset_ids,
                )
                .execute(&self.pool)
                .await
                .map_err(storage)?;
            }
            None => {
                sqlx::query!(
                    "DELETE FROM team_runtime_preset_allowlist WHERE team_id = $1",
                    team_id,
                )
                .execute(&self.pool)
                .await
                .map_err(storage)?;
            }
        }
        Ok(())
    }

    async fn runtime_allowlist(&self, team_id: Uuid) -> Result<Option<RuntimePresetAllowlist>> {
        let row = sqlx::query!(
            "SELECT preset_ids FROM team_runtime_preset_allowlist WHERE team_id = $1",
            team_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        row.map(|row| {
            row.preset_ids
                .into_iter()
                .map(|id| {
                    RuntimePreset::from_str(&id)
                        .map_err(|_| EnterpriseError::UnknownStoredPreset(id))
                })
                .collect::<Result<Vec<_>>>()
                .map(|preset_ids| RuntimePresetAllowlist { preset_ids })
        })
        .transpose()
    }

    async fn record(&self, record: AuditRecord) -> Result<()> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        audit::append(&mut transaction, &record)
            .await
            .map_err(storage)?;
        transaction.commit().await.map_err(storage)
    }
}
