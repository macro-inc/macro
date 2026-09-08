//! Owner-checked email-thread sharing shared by REST and unified mutations.

use std::future::Future;

use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use model_entity::EntityType;
use models_permissions::share_permission::{
    UpdateSharePermissionRequestV2,
    team_share::{
        AuthorizedTeamShareCommand, TeamShareFacts, TeamShareLevel, TeamSharePolicyError,
        TeamShareRequest, authorize_team_share,
    },
};

#[cfg(test)]
mod test;

/// Failures classified independently of either transport or database implementation.
#[derive(Debug, thiserror::Error)]
pub enum ThreadShareError {
    /// The authoritative thread is missing.
    #[error("thread not found")]
    NotFound,
    /// Actual-owner policy rejected a supplied team operation.
    #[error(transparent)]
    Policy(#[from] TeamSharePolicyError),
    /// The receipt is not for a valid email thread.
    #[error("invalid thread sharing input")]
    InvalidInput,
    /// Authoritative facts changed or an untracked grant prevents safe persistence.
    #[error("thread sharing conflicts with current state")]
    Conflict,
    /// Persistence failed; the report retains its cause.
    #[error("thread sharing failed: {0}")]
    Internal(rootcause::Report),
}

/// Authoritative reads and a single atomic share-policy write.
pub trait ThreadShareRepository: Send + Sync + 'static {
    /// Read ownership through the email link without lazily creating permissions.
    fn owner_facts(
        &self,
        thread_id: uuid::Uuid,
    ) -> impl Future<Output = Result<TeamShareFacts, ThreadShareError>> + Send;

    /// Recheck a supplied command and persist all fields atomically. Lazy permission
    /// creation must happen only inside this write transaction, after authorization.
    fn persist(
        &self,
        thread_id: uuid::Uuid,
        policy: UpdateSharePermissionRequestV2,
        command: Option<AuthorizedTeamShareCommand>,
    ) -> impl Future<Output = Result<(), ThreadShareError>> + Send;
}

/// Narrow sharing domain service; transport adapters supply verified Owner receipts.
pub struct ThreadSharePolicyService<R> {
    repository: R,
}

impl<R: ThreadShareRepository> ThreadSharePolicyService<R> {
    /// Compose with the thread-sharing persistence port.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Preserve the existing Owner access requirement for all share edits, and
    /// additionally require actual ownership whenever the team field is supplied.
    #[tracing::instrument(skip_all, err)]
    pub async fn update_share_policy(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<(), ThreadShareError> {
        if receipt.entity().entity_type != EntityType::EmailThread {
            return Err(ThreadShareError::InvalidInput);
        }
        let thread_id = uuid::Uuid::parse_str(&receipt.entity().entity_id)
            .map_err(|_| ThreadShareError::InvalidInput)?;
        let command = if policy.team_share_access_level.is_some() {
            let facts = self.repository.owner_facts(thread_id).await?;
            authorize_team_share(
                receipt.acting_user_id(),
                &facts,
                TeamShareRequest {
                    access_level: policy.team_share_access_level,
                    legacy_enabled: None,
                },
                TeamShareLevel::View,
            )?
        } else {
            None
        };
        self.repository.persist(thread_id, policy, command).await
    }
}
