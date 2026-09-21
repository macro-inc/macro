//! Authorization, entitlement, and fail-closed disclosure policy.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Authoritative status for the authenticated user's workspace.
#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PrivacyStatus {
    /// Current workspace, if any.
    pub team_id: Option<Uuid>,
    /// Whether content protection is enabled. Independent of payment status.
    pub hipaa_enabled: bool,
    /// Whether an administrator has completed the deployment/BAA readiness review.
    pub hipaa_ready: bool,
    /// Whether this workspace has paid access (including contracted enterprise).
    pub paid: bool,
    /// Whether this user may change workspace settings.
    pub is_admin: bool,
    /// Optimistic concurrency version for changes to the setting.
    pub revision: i64,
}

/// Explicit desired state, with the version the admin reviewed.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct SetPrivacyRequest {
    /// Desired state; this is intentionally not a toggle operation.
    pub enabled: bool,
    /// Version returned by the status endpoint.
    pub expected_revision: i64,
}

/// Safe errors: never return storage errors or content to callers/loggers.
#[derive(Debug, thiserror::Error)]
pub enum PrivacyError {
    /// Only admins/owners of the current workspace can change this setting.
    #[error("Only workspace admins can change HIPAA safeguards")]
    Forbidden,
    /// Enabling requires paid access; disabling never depends on billing.
    #[error("Upgrade this workspace to a paid plan to enable HIPAA safeguards")]
    PaymentRequired,
    /// Controlled outside the customer API after the readiness checklist is complete.
    #[error("Contact Macro to complete the BAA and HIPAA readiness review")]
    NotReady,
    /// State, membership, or billing changed since it was read.
    #[error("Workspace settings changed; refresh and try again")]
    Conflict,
    /// A policy lookup failed. Consumers must not disclose content.
    #[error("Privacy policy is temporarily unavailable")]
    Unavailable,
}

/// Storage port. Mutations must recheck authorization/entitlement atomically and audit changes.
#[async_trait]
pub trait PrivacyRepository: Send + Sync + 'static {
    /// Read fresh policy and membership, without caching a permissive answer.
    async fn status(&self, user_id: &str) -> Result<PrivacyStatus, PrivacyError>;
    /// Atomically persist a reviewed state change and its audit record.
    async fn set(
        &self,
        user_id: &str,
        team_id: Uuid,
        request: &SetPrivacyRequest,
    ) -> Result<(), PrivacyError>;
}

/// Disclosure checks used immediately before an external send.
#[async_trait]
pub trait DisclosurePolicy: Send + Sync + 'static {
    /// Source workspace, including events about a member who has just left.
    async fn restricted_team(&self, team_id: Uuid) -> Result<bool, PrivacyError>;
    /// A user id or email; unknown identity must never authorize analytics.
    async fn restricted_user(&self, user_id: &str) -> Result<bool, PrivacyError>;
    /// Includes recipient and persisted notification participants. Missing provenance is restricted.
    async fn restricted_push(
        &self,
        endpoint: &str,
        notification_id: Option<Uuid>,
    ) -> Result<bool, PrivacyError>;
    /// Used for legacy events with no trustworthy workspace/source identity.
    async fn any_restricted_workspace(&self) -> Result<bool, PrivacyError>;
}

/// Domain service for workspace settings.
pub struct PrivacyService<R>(pub R);

impl<R: PrivacyRepository> PrivacyService<R> {
    /// Status is derived from authenticated identity, never a client-supplied workspace id.
    pub async fn status(&self, user_id: &str) -> Result<PrivacyStatus, PrivacyError> {
        self.0.status(user_id).await
    }

    /// Validate authorization and paid/readiness requirements before a guarded storage mutation.
    pub async fn set(
        &self,
        user_id: &str,
        request: &SetPrivacyRequest,
    ) -> Result<PrivacyStatus, PrivacyError> {
        let current = self.status(user_id).await?;
        let team_id = current.team_id.ok_or(PrivacyError::Forbidden)?;
        authorize_change(&current, request)?;
        self.0.set(user_id, team_id, request).await?;
        self.status(user_id).await
    }
}

fn authorize_change(
    current: &PrivacyStatus,
    request: &SetPrivacyRequest,
) -> Result<(), PrivacyError> {
    if !current.is_admin {
        return Err(PrivacyError::Forbidden);
    }
    if current.revision != request.expected_revision {
        return Err(PrivacyError::Conflict);
    }
    if request.enabled && !current.hipaa_enabled {
        if !current.paid {
            return Err(PrivacyError::PaymentRequired);
        }
        if !current.hipaa_ready {
            return Err(PrivacyError::NotReady);
        }
    }
    Ok(())
}

#[cfg(test)]
mod test;
