//! Facts and effects used by link-maintenance delivery policy.

use super::super::MailboxError;
use super::super::health::{InboxHealthGateway, InboxHealthRepository, InboxHealthService};
use super::super::lifecycle::{
    InboxLifecycleEffects, InboxLifecycleError, InboxLifecycleRepository, InboxLifecycleService,
};
use crate::domain::mailbox::connection::ConnectionSourceError;
use crate::domain::message_labels::gmail_ops::GmailOpsLinks;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::link::Link;
use models_email::service::pubsub::DeletionReason;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

/// Link lookup shared with Gmail operations, plus delegated notification recipients.
pub trait LinkManagerRepository: GmailOpsLinks {
    /// Read delegated primary identities for the current owner and link.
    fn primaries(
        &self,
        owner: &str,
        link: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;
}

/// Existing health policy, including token acquisition and provider maintenance.
pub trait LinkManagerHealth: Send + Sync + 'static {
    /// Probe with the original refresh-vs-health-check token freshness.
    fn probe(
        &self,
        link: Uuid,
        refresh: bool,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

impl<R: InboxHealthRepository, G: InboxHealthGateway> LinkManagerHealth
    for Arc<InboxHealthService<R, G>>
{
    async fn probe(&self, link: Uuid, refresh: bool) -> Result<(), MailboxError> {
        self.as_ref().probe(link, refresh).await
    }
}

/// Reuse the mailbox domain's preparation and deleted-user workflow.
pub trait LinkManagerLifecycle: Send + Sync + 'static {
    /// Decide whether physical deletion can proceed now.
    fn prepare_delete(
        &self,
        link: Uuid,
        reason: DeletionReason,
    ) -> impl Future<Output = Result<bool, InboxLifecycleError>> + Send;
    /// Process the existing ordered bindings for a deleted credential owner.
    fn deleted_user(
        &self,
        owner: &str,
    ) -> impl Future<Output = Result<(), InboxLifecycleError>> + Send;
}

impl<R: InboxLifecycleRepository, E: InboxLifecycleEffects> LinkManagerLifecycle
    for Arc<InboxLifecycleService<R, E>>
{
    async fn prepare_delete(
        &self,
        link: Uuid,
        reason: DeletionReason,
    ) -> Result<bool, InboxLifecycleError> {
        self.as_ref().prepare_delete(link, reason).await
    }
    async fn deleted_user(&self, owner: &str) -> Result<(), InboxLifecycleError> {
        self.as_ref().deleted_user(owner).await
    }
}

/// Owner and delegates selected by the domain for a reconnect notification.
pub struct ReauthNotification {
    /// Current link owner and notification entity.
    pub owner: MacroUserIdStr<'static>,
    /// Existing notification's inbox address.
    pub email_address: String,
    /// The owner and valid delegated primaries, deduplicated by identity.
    pub recipient_ids: HashSet<MacroUserIdStr<'static>>,
}

/// Deliver the existing reconnect notification to the selected identities.
pub trait LinkManagerNotifications: Send + Sync + 'static {
    /// Preserve the original notification error's display text.
    type Err: ConnectionSourceError;
    /// Send using the existing notification ingress and connection gateway routing.
    fn send(
        &self,
        notification: ReauthNotification,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Interim boundary for physical deletion; replaced by individual ports in stage C.
pub trait LegacyLinkDeletion: Send + Sync + 'static {
    /// Run the existing physical-deletion workflow without translating its error.
    fn delete(
        &self,
        link: &Link,
        reason: &DeletionReason,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
