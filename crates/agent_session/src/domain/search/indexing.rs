//! Internal search projection reads. ACP remains the source of every message.

use agent_fold::domain::{model::FoldedMessage, ports::FoldedMessageRepo};
use macro_uuid::Uuid;
use rootcause::Report;

use super::{AgentSessionSearchMetadata, AgentSessionSearchMetadataRepo};
use crate::domain::model::AgentSessionId;

/// Persistence capabilities used only by the trusted search indexer.
pub trait SearchIndexingRepo: AgentSessionSearchMetadataRepo {
    /// A cross-process lease released when dropped.
    type Lease: Send;

    /// Serialize a session's live indexing and backfill across all workers.
    fn lock(&self, id: AgentSessionId) -> impl Future<Output = Result<Self::Lease, Report>> + Send;

    /// Walk existing sessions by UUID, returning at most 100 IDs.
    fn page(&self, after: Option<Uuid>) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
}

/// A session's current metadata and messages derived from its effective ACP log.
pub struct SearchSnapshot {
    /// Current database metadata; missing sessions have no snapshot.
    pub metadata: AgentSessionSearchMetadata,
    /// The same folded messages that the transcript renders.
    pub messages: Vec<FoldedMessage>,
}

/// Domain API for trusted background indexing, separate from user-facing reads.
pub trait SearchSnapshotService: Send + Sync + 'static {
    /// Lease kept alive until the index operation finishes.
    type Lease: Send;
    /// Acquire the session's indexing lease before loading its current snapshot.
    fn lock(&self, id: AgentSessionId) -> impl Future<Output = Result<Self::Lease, Report>> + Send;
    /// Missing/deleted sessions return `None`; storage errors remain errors.
    fn snapshot(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<Option<SearchSnapshot>, Report>> + Send;
    /// Enumerate a bounded page for a full repair/backfill.
    fn page(&self, after: Option<Uuid>) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
}

/// Composes the owning repository and fold service without exposing storage to callers.
pub struct SearchSnapshotServiceImpl<R, F> {
    repo: R,
    folds: F,
}

impl<R, F> SearchSnapshotServiceImpl<R, F> {
    /// Assemble the metadata and folded-message capabilities.
    pub fn new(repo: R, folds: F) -> Self {
        Self { repo, folds }
    }
}

impl<R, F> SearchSnapshotService for SearchSnapshotServiceImpl<R, F>
where
    R: SearchIndexingRepo,
    F: FoldedMessageRepo + Send + Sync + 'static,
{
    type Lease = R::Lease;

    async fn lock(&self, id: AgentSessionId) -> Result<Self::Lease, Report> {
        self.repo.lock(id).await
    }

    async fn snapshot(&self, id: AgentSessionId) -> Result<Option<SearchSnapshot>, Report> {
        let Some(metadata) = self.repo.search_metadata(&[id.as_uuid()]).await?.pop() else {
            return Ok(None);
        };
        let messages = self.folds.messages(id).await?;
        Ok(Some(SearchSnapshot { metadata, messages }))
    }

    async fn page(&self, after: Option<Uuid>) -> Result<Vec<Uuid>, Report> {
        self.repo.page(after).await
    }
}
