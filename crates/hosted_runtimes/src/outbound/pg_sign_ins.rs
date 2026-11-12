//! [`ClaudeSignIns`] in Postgres: computers whose harness has an active
//! Claude login, read from `harness_account_logins`, `harnesses` and
//! `hosted_runtime`, and the awake computers whose sign-in state the control
//! plane refreshes.

#[cfg(test)]
mod test;

use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::claude_sign_in::{
    ClaudeSignIn, ClaudeSignInNotice, ClaudeSignInStage, ClaudeSignIns,
};
use crate::domain::ids::ComputerId;

/// Why the watched sign-ins could not be read or recorded.
#[derive(Debug, thiserror::Error)]
pub enum ClaudeSignInsError {
    /// The database failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// [`ClaudeSignIns`] over the `harness_account_logins`, `harnesses` and
/// `hosted_runtime` tables.
pub struct PgClaudeSignIns {
    pool: PgPool,
}

impl PgClaudeSignIns {
    /// Read and record through `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ClaudeSignIns for PgClaudeSignIns {
    type Err = ClaudeSignInsError;

    async fn signed_in(&self) -> Result<Vec<ClaudeSignIn>, ClaudeSignInsError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                login.id AS login_id,
                c.id AS computer_id,
                c.team_id,
                h.id AS harness_id,
                h.name,
                login.signed_in_by,
                login.signed_in_at,
                login.expires_at,
                login.notice_stage AS "notice_stage: ClaudeSignInStage",
                login.notice_expires_at
            FROM harness_account_logins login
            JOIN harnesses h ON h.id = login.harness_id
            JOIN hosted_runtime c ON c.id = h.computer_id
            WHERE h.deleted_at IS NULL
              AND login.provider = 'claude'
              AND login.signed_out_at IS NULL
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let computer_id = ComputerId::new_from_uuid(row.computer_id);
                // One unreadable row is skipped, not the whole pass.
                let signed_in_by = match row.signed_in_by.map(MacroUserIdStr::try_from).transpose()
                {
                    Ok(signed_in_by) => signed_in_by,
                    Err(_) => {
                        tracing::error!(%computer_id, "computer has an invalid Claude signer");
                        return None;
                    }
                };
                let last_notice = row.notice_stage.map(|stage| ClaudeSignInNotice {
                    signed_in_at: row.signed_in_at,
                    stage,
                    expires_at: row.notice_expires_at,
                });
                Some(ClaudeSignIn {
                    login_id: row.login_id,
                    computer_id,
                    harness_id: HarnessId::new_from_uuid(row.harness_id),
                    team_id: row.team_id,
                    computer_name: row.name,
                    signed_in_by,
                    signed_in_at: row.signed_in_at,
                    expires_at: row.expires_at,
                    last_notice,
                })
            })
            .collect())
    }

    async fn record_notice(
        &self,
        login_id: Uuid,
        notice: ClaudeSignInNotice,
    ) -> Result<(), ClaudeSignInsError> {
        sqlx::query!(
            r#"
            UPDATE harness_account_logins
            SET notice_stage = $2, notice_expires_at = $3
            WHERE id = $1
            "#,
            login_id,
            notice.stage as ClaudeSignInStage,
            notice.expires_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

impl PgClaudeSignIns {
    /// Every awake computer that has a harness, as `(harness, computer)`.
    pub async fn awake_computers(&self) -> Result<Vec<(HarnessId, ComputerId)>, ClaudeSignInsError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, harness_id AS "harness_id!"
            FROM hosted_runtime
            WHERE awake AND harness_id IS NOT NULL
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    HarnessId::new_from_uuid(row.harness_id),
                    ComputerId::new_from_uuid(row.id),
                )
            })
            .collect())
    }
}
