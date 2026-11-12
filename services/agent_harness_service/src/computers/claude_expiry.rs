//! The ports of the control plane's Claude sign-in watch
//! (`hosted_runtimes::domain::claude_sign_in`): computers signed in to Claude
//! through Macro, read from their active Claude login, harness and computer
//! rows; the team's
//! admins; and the `agent_sign_in_expiry` notification.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::sync::Arc;

use harness_id::HarnessId;
use hosted_runtimes::domain::claude_sign_in::{
    ClaudeSignIn, ClaudeSignInNotice, ClaudeSignInNotices, ClaudeSignInStage, ClaudeSignIns,
    SignInExpiry,
};
use hosted_runtimes::domain::ids::ComputerId;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{AgentProvider, AgentSignInExpiryMetadata, AgentSignInExpiryStage};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use sqlx::PgPool;
use teams::domain::model::{TeamError, TeamRole};
use teams::domain::team_repo::TeamRepository;
use teams::outbound::team_repo::TeamRepositoryImpl;
use uuid::Uuid;

/// The namespace expiry notification ids are derived in, so every replica
/// and every retry of one notice creates the same notification. Fixed
/// forever.
const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6d61_6372_6f2d_636c_6175_6465_2d65_7870);

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

/// Why a notice could not be addressed or sent.
#[derive(Debug, thiserror::Error)]
pub enum ClaudeSignInNoticeError {
    /// The team's members could not be read.
    #[error(transparent)]
    Team(#[from] TeamError),
    /// The notification ingress refused the notice.
    #[error("{0}")]
    Send(rootcause::Report),
}

/// [`ClaudeSignInNotices`] over the teams tables and the notification ingress.
pub struct IngressClaudeSignInNotices<Ingress> {
    ingress: Arc<Ingress>,
    teams: TeamRepositoryImpl,
}

impl<Ingress> IngressClaudeSignInNotices<Ingress> {
    /// Address through `teams` and send through `ingress`.
    pub fn new(ingress: Arc<Ingress>, teams: TeamRepositoryImpl) -> Self {
        Self { ingress, teams }
    }
}

impl<Ingress: NotificationIngress> ClaudeSignInNotices for IngressClaudeSignInNotices<Ingress> {
    type Err = ClaudeSignInNoticeError;

    async fn team_admins(
        &self,
        team_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, ClaudeSignInNoticeError> {
        Ok(self
            .teams
            .get_all_team_members(&team_id)
            .await?
            .into_iter()
            .filter(|member| member.role >= TeamRole::Admin)
            .map(|member| member.user_id.into_owned())
            .collect())
    }

    async fn send(
        &self,
        expiry: SignInExpiry,
        recipients: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), ClaudeSignInNoticeError> {
        let notification_id = notification_id(&expiry);
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Harness
                .with_entity_string(expiry.harness_id.to_string()),
            secondary_notification_entity: None,
            notification: AgentSignInExpiryMetadata {
                agent: AgentProvider::Claude,
                harness_id: expiry.harness_id.as_uuid(),
                computer_name: expiry.computer_name,
                stage: match expiry.notice.stage {
                    ClaudeSignInStage::ExpiresSoon => AgentSignInExpiryStage::ExpiresSoon,
                    ClaudeSignInStage::ExpiresToday => AgentSignInExpiryStage::ExpiresToday,
                    ClaudeSignInStage::Expired => AgentSignInExpiryStage::Expired,
                },
                expires_at: expiry.notice.expires_at,
            },
            sender_id: None,
            recipient_ids: recipients,
        }
        .into_request_with_id(notification_id)
        .with_apns()
        .with_conn_gateway();
        self.ingress
            .send_notification(request)
            .await
            .map_err(|error| ClaudeSignInNoticeError::Send(error.into_dynamic()))?;
        Ok(())
    }
}

/// The same for every delivery of one notice: its computer, sign-in, stage
/// and expiry.
fn notification_id(expiry: &SignInExpiry) -> Uuid {
    let notice = expiry.notice;
    let expires_at = notice
        .expires_at
        .map(|expires_at| expires_at.to_rfc3339())
        .unwrap_or_default();
    let name = format!(
        "{}:{}:{}:{expires_at}",
        expiry.harness_id,
        notice.signed_in_at.to_rfc3339(),
        notice.stage.as_ref(),
    );
    Uuid::new_v5(&NOTIFICATION_ID_NAMESPACE, name.as_bytes())
}
