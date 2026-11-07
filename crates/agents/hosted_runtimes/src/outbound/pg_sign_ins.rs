//! [`ClaudeSignIns`] in Postgres: the active Claude logins on computer
//! harnesses, read and noted through `crates/agents/harnesses`' repository, with
//! each computer's team from `hosted_runtime`.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use harnesses::domain::account_logins::{
    AccountLoginNotice, AccountNoticeStage, AgentProvider, ComputerAccountLogin,
};
use harnesses::domain::ports::HarnessRepo;
use harnesses::outbound::pg_harness_repo::PgHarnessRepo;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::claude_sign_in::{
    ClaudeSignIn, ClaudeSignInNotice, ClaudeSignInStage, ClaudeSignIns,
};

/// Why the watched sign-ins could not be read or recorded.
#[derive(Debug, thiserror::Error)]
pub enum ClaudeSignInsError {
    /// The database failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// The harnesses repository failed.
    #[error(transparent)]
    Logins(Box<dyn std::error::Error + Send + Sync>),
}

/// [`ClaudeSignIns`] over the harnesses repository and `hosted_runtime`.
pub struct PgClaudeSignIns {
    pool: PgPool,
    harnesses: PgHarnessRepo,
}

impl PgClaudeSignIns {
    /// Read and record through `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self {
            harnesses: PgHarnessRepo::new(pool.clone()),
            pool,
        }
    }
}

fn notice_stage(stage: AccountNoticeStage) -> ClaudeSignInStage {
    match stage {
        AccountNoticeStage::ExpiresSoon => ClaudeSignInStage::ExpiresSoon,
        AccountNoticeStage::ExpiresToday => ClaudeSignInStage::ExpiresToday,
        AccountNoticeStage::Expired => ClaudeSignInStage::Expired,
    }
}

fn account_notice_stage(stage: ClaudeSignInStage) -> AccountNoticeStage {
    match stage {
        ClaudeSignInStage::ExpiresSoon => AccountNoticeStage::ExpiresSoon,
        ClaudeSignInStage::ExpiresToday => AccountNoticeStage::ExpiresToday,
        ClaudeSignInStage::Expired => AccountNoticeStage::Expired,
    }
}

impl ClaudeSignIns for PgClaudeSignIns {
    type Err = ClaudeSignInsError;

    async fn signed_in(&self) -> Result<Vec<ClaudeSignIn>, ClaudeSignInsError> {
        let logins = self
            .harnesses
            .computer_account_logins(AgentProvider::Claude)
            .await
            .map_err(|error| ClaudeSignInsError::Logins(error.into()))?;
        let computer_ids = logins
            .iter()
            .map(|login| login.computer_id.as_uuid())
            .collect::<Vec<_>>();
        let teams = sqlx::query!(
            "SELECT id, team_id FROM hosted_runtime WHERE id = ANY($1)",
            &computer_ids,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| (row.id, row.team_id))
        .collect::<HashMap<Uuid, Uuid>>();

        Ok(logins
            .into_iter()
            .filter_map(|login| sign_in(login, &teams))
            .collect())
    }

    async fn record_notice(
        &self,
        login_id: Uuid,
        notice: ClaudeSignInNotice,
    ) -> Result<(), ClaudeSignInsError> {
        self.harnesses
            .record_login_notice(
                login_id,
                AccountLoginNotice {
                    stage: account_notice_stage(notice.stage),
                    expires_at: notice.expires_at,
                },
            )
            .await
            .map_err(|error| ClaudeSignInsError::Logins(error.into()))
    }
}

/// The sign-in for one login, or `None` when its computer row is gone or
/// its signer is unreadable; one bad row is skipped, not the whole pass.
fn sign_in(login: ComputerAccountLogin, teams: &HashMap<Uuid, Uuid>) -> Option<ClaudeSignIn> {
    let computer_id = login.computer_id;
    let team_id = *teams.get(&computer_id.as_uuid())?;
    let signed_in_by = match login.signed_in_by.map(MacroUserIdStr::try_from).transpose() {
        Ok(signed_in_by) => signed_in_by,
        Err(_) => {
            tracing::error!(%computer_id, "computer has an invalid Claude signer");
            return None;
        }
    };
    let last_notice = login.last_notice.map(|notice| ClaudeSignInNotice {
        signed_in_at: login.signed_in_at,
        stage: notice_stage(notice.stage),
        expires_at: notice.expires_at,
    });
    Some(ClaudeSignIn {
        login_id: login.login_id,
        computer_id,
        harness_id: login.harness_id,
        team_id,
        computer_name: login.harness_name,
        signed_in_by,
        signed_in_at: login.signed_in_at,
        expires_at: login.expires_at,
        last_notice,
    })
}
