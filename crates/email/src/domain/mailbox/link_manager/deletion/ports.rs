//! Capabilities used by physical link deletion, preserving the existing leaf errors.

use super::super::purge::{LinkPurgeRepository, LinkPurgeService, PurgePacing, PurgeSummary};
use crm::domain::{model::CrmError, service::CrmService};
use email_api_client::domain::models::EmailApiError;
use models_email::{
    api::refresh::RefreshEmailEvent,
    service::{cache::TokenCacheKey, link::Link},
};
use std::error::Error;
use uuid::Uuid;

/// Link history and job updates outside the incremental purge transactions.
pub trait LinkDeletionRepository: Send + Sync + 'static {
    /// Acquisition errors retain their native Debug representation.
    type AcquireError: Error + Send + Sync + 'static;
    /// Keep this connection alive through the identity-service cleanup.
    type Connection: PromotedMailboxCleanup;
    /// Freeze synchronization before any external teardown.
    fn mark_link_deleting(&self, link: Uuid) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Cancel active backfills, returning their original errors.
    fn cancel_active_jobs(&self, link: Uuid) -> impl Future<Output = anyhow::Result<usize>> + Send;
    /// Mark the existing history row after the purge and notifications.
    fn set_deleted_at(
        &self,
        link: Uuid,
        reason: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Acquire the connection used for promoted-mailbox cleanup.
    fn acquire(&self) -> impl Future<Output = Result<Self::Connection, Self::AcquireError>> + Send;
}

/// The original two autocommit statements on one held connection.
pub trait PromotedMailboxCleanup: Send {
    /// Remove a promoted mailbox's user rows and return its authoritative minted identity.
    fn delete_promoted_mailbox_user(
        &mut self,
        owner: &str,
    ) -> impl Future<Output = anyhow::Result<Option<Uuid>>> + Send;
}

/// Gmail's health-neutral watch teardown and cached credential eviction.
pub trait LinkDeletionGmail: Send + Sync + 'static {
    /// Make one stop-watch attempt without changing link health.
    fn stop_subscription_for_link(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    /// Delete precisely the domain-selected cached token key.
    fn delete_gmail_access_token(
        &self,
        key: &TokenCacheKey,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Credential unlinking and deletion of a promoted mailbox's dedicated stub.
pub trait LinkDeletionAuth: Send + Sync + 'static {
    /// Keep identity-service errors unchanged for the existing warning/error events.
    type Err: Error + Send + Sync + 'static;
    /// Remove the Gmail grant selected by the domain.
    fn remove_link(
        &self,
        user: &str,
        email: &str,
        provider: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Delete only the authoritative minted mailbox identity returned by persistence.
    fn delete_inbox_grant_user(
        &self,
        user: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Reuse the CRM domain's existing team lookup and link-contribution teardown.
pub trait LinkDeletionCrm: Send + Sync + 'static {
    /// The current team, if the owner belongs to one.
    fn get_team_id_for_user(
        &self,
        owner: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, CrmError>> + Send;
    /// Remove only this link's contributions within that team.
    fn depopulate_link_in_team(
        &self,
        team: &Uuid,
        link: &Uuid,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}

impl<T: CrmService> LinkDeletionCrm for T {
    async fn get_team_id_for_user(&self, owner: &str) -> Result<Option<Uuid>, CrmError> {
        CrmService::get_team_id_for_user(self, owner).await
    }
    async fn depopulate_link_in_team(&self, team: &Uuid, link: &Uuid) -> Result<(), CrmError> {
        CrmService::depopulate_link_in_team(self, team, link).await
    }
}

/// The incremental purge use case already owns its order, pacing and transactions.
pub trait LinkPurger: Send + Sync + 'static {
    /// Run that service with the domain-selected pacing.
    fn purge_link(
        &self,
        link: Uuid,
        pacing: PurgePacing,
    ) -> impl Future<Output = anyhow::Result<PurgeSummary>> + Send;
}

impl<R: LinkPurgeRepository> LinkPurger for LinkPurgeService<R> {
    async fn purge_link(&self, link: Uuid, pacing: PurgePacing) -> anyhow::Result<PurgeSummary> {
        LinkPurgeService::purge_link(self, link, pacing).await
    }
}

/// Best-effort delivery of the existing client refresh after physical deletion.
pub trait LinkDeletionRefresh: Send + Sync + 'static {
    /// Forward the owner and payload without changing the feature-gated refresh behavior.
    fn refresh_email(
        &self,
        owner: &str,
        event: RefreshEmailEvent,
    ) -> impl Future<Output = ()> + Send;
}
