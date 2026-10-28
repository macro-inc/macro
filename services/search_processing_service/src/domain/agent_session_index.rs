//! Reconcile the search projection from the owning agent-session domain service.

use std::{collections::HashSet, sync::Arc};

use agent_session::domain::{
    model::AgentSessionId,
    search::indexing::{SearchSnapshot, SearchSnapshotService},
};
use rootcause::Report;
use serde::Deserialize;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    jobs::JobProgress,
    models::{BackfillError, BackfillReceipt},
};

#[cfg(test)]
mod test;

/// Index operations over a folded snapshot; no ACP parsing belongs in the adapter.
pub trait AgentSessionSearchIndex: Send + Sync + 'static {
    fn reconcile(
        &self,
        snapshot: SearchSnapshot,
        index_override: Option<&str>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    fn delete(
        &self,
        id: AgentSessionId,
        index_override: Option<&str>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Repair selected sessions, or scan every existing session when IDs are omitted.
/// A full scan deliberately does not filter on metadata timestamps: log appends
/// need not change `agent_session.modified_at`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AgentSessionBackfillRequest {
    pub agent_session_ids: Vec<Uuid>,
    pub index_override: Option<String>,
}

/// Owns serialization, authoritative rereads, and deletion of missing sessions.
pub struct AgentSessionIndexService<S, I> {
    source: S,
    index: I,
}

impl<S, I> AgentSessionIndexService<S, I> {
    pub fn new(source: S, index: I) -> Self {
        Self { source, index }
    }
}

impl<S: SearchSnapshotService, I: AgentSessionSearchIndex> AgentSessionIndexService<S, I> {
    /// Events are hints to reread, so delayed events cannot resurrect deleted sessions.
    #[tracing::instrument(err, skip(self, index_override))]
    pub async fn reconcile(
        &self,
        id: AgentSessionId,
        index_override: Option<&str>,
    ) -> Result<(), Report> {
        let _lease = self.source.lock(id).await?;
        match self.source.snapshot(id).await? {
            Some(snapshot) => self.index.reconcile(snapshot, index_override).await,
            None => self.index.delete(id, index_override).await,
        }
    }

    /// Backfill and live events use the same service and cross-process session lease.
    pub async fn backfill(
        &self,
        req: AgentSessionBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        let mut enqueued = 0;
        if !req.agent_session_ids.is_empty() {
            let mut seen = HashSet::new();
            for id in req.agent_session_ids {
                if cancel.is_cancelled() {
                    break;
                }
                if !seen.insert(id) {
                    continue;
                }
                self.reconcile(
                    AgentSessionId::new_from_uuid(id),
                    req.index_override.as_deref(),
                )
                .await
                .map_err(|e| BackfillError::Reindex(anyhow::anyhow!("{e:#}")))?;
                enqueued += 1;
                progress.add(1).await;
            }
        } else {
            let mut after = None;
            while !cancel.is_cancelled() {
                let ids = self
                    .source
                    .page(after)
                    .await
                    .map_err(|e| BackfillError::Source(anyhow::anyhow!("{e:#}")))?;
                if ids.is_empty() {
                    break;
                }
                for id in ids {
                    if cancel.is_cancelled() {
                        break;
                    }
                    self.reconcile(
                        AgentSessionId::new_from_uuid(id),
                        req.index_override.as_deref(),
                    )
                    .await
                    .map_err(|e| BackfillError::Reindex(anyhow::anyhow!("{e:#}")))?;
                    after = Some(id);
                    enqueued += 1;
                    progress.add(1).await;
                }
            }
        }
        Ok(BackfillReceipt { enqueued })
    }
}
