//! The ports of the control plane's Claude sign-in watch
//! (`hosted_runtimes::domain::claude_sign_in`): computers signed in to Claude
//! through Macro, read from their harness and computer rows; the team's
//! admins; and the `claude_sign_in_expiry` notification.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::sync::Arc;

use harness_id::HarnessId;
use harnesses::domain::models::{ClaudeAccount, HarnessCapabilities};
use hosted_runtimes::domain::claude_sign_in::{
    ClaudeReport, ClaudeSignIn, ClaudeSignInExpiry, ClaudeSignInNotice, ClaudeSignInNotices,
    ClaudeSignInStage, ClaudeSignIns,
};
use hosted_runtimes::domain::ids::ComputerId;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{ClaudeSignInExpiryMetadata, ClaudeSignInExpiryStage};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use sqlx::PgPool;
use sqlx::types::Json;
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

/// [`ClaudeSignIns`] over the `harnesses` and `hosted_runtime` tables.
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
                c.id AS computer_id,
                c.team_id,
                h.id AS harness_id,
                h.name,
                h.claude_signed_in_by AS "claude_signed_in_by!",
                h.claude_signed_in_at AS "claude_signed_in_at!",
                h.capabilities AS "capabilities: Json<HarnessCapabilities>",
                h.capabilities_reported_at,
                c.claude_notice_stage,
                c.claude_notice_signed_in_at,
                c.claude_notice_expires_at
            FROM harnesses h
            JOIN hosted_runtime c ON c.id = h.computer_id
            WHERE h.deleted_at IS NULL
              AND h.claude_mode = 'own_account'
              AND h.claude_signed_in_by IS NOT NULL
              AND h.claude_signed_in_at IS NOT NULL
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let computer_id = ComputerId::new_from_uuid(row.computer_id);
                // One unreadable row is skipped, not the whole pass.
                let Ok(signed_in_by) = MacroUserIdStr::try_from(row.claude_signed_in_by) else {
                    tracing::error!(%computer_id, "computer has an invalid Claude signer");
                    return None;
                };
                let last_notice = match (row.claude_notice_stage, row.claude_notice_signed_in_at) {
                    (Some(stage), Some(signed_in_at)) => {
                        let Ok(stage) = stage.parse::<ClaudeSignInStage>() else {
                            tracing::error!(%computer_id, "computer has an invalid Claude notice stage");
                            return None;
                        };
                        Some(ClaudeSignInNotice {
                            signed_in_at,
                            stage,
                            expires_at: row.claude_notice_expires_at,
                        })
                    }
                    _ => None,
                };
                let report = row.capabilities.0.claude.map(|account| match account {
                    ClaudeAccount::SignedOut => ClaudeReport::SignedOut,
                    ClaudeAccount::SignedIn { expires_at, .. } => {
                        ClaudeReport::SignedIn { expires_at }
                    }
                });
                Some(ClaudeSignIn {
                    computer_id,
                    harness_id: HarnessId::new_from_uuid(row.harness_id),
                    team_id: row.team_id,
                    computer_name: row.name,
                    signed_in_by,
                    signed_in_at: row.claude_signed_in_at,
                    report,
                    reported_at: row.capabilities_reported_at,
                    last_notice,
                })
            })
            .collect())
    }

    async fn record_notice(
        &self,
        computer_id: ComputerId,
        notice: ClaudeSignInNotice,
    ) -> Result<(), ClaudeSignInsError> {
        sqlx::query!(
            r#"
            UPDATE hosted_runtime
            SET claude_notice_stage = $2,
                claude_notice_signed_in_at = $3,
                claude_notice_expires_at = $4
            WHERE id = $1
            "#,
            computer_id.as_uuid(),
            notice.stage.as_ref(),
            notice.signed_in_at,
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
        expiry: ClaudeSignInExpiry,
        recipients: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), ClaudeSignInNoticeError> {
        let notification_id = notification_id(&expiry);
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Harness
                .with_entity_string(expiry.harness_id.to_string()),
            secondary_notification_entity: None,
            notification: ClaudeSignInExpiryMetadata {
                harness_id: expiry.harness_id.as_uuid(),
                computer_name: expiry.computer_name,
                stage: match expiry.notice.stage {
                    ClaudeSignInStage::ExpiresSoon => ClaudeSignInExpiryStage::ExpiresSoon,
                    ClaudeSignInStage::ExpiresToday => ClaudeSignInExpiryStage::ExpiresToday,
                    ClaudeSignInStage::Expired => ClaudeSignInExpiryStage::Expired,
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
fn notification_id(expiry: &ClaudeSignInExpiry) -> Uuid {
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
