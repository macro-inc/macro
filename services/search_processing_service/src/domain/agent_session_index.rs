//! Reconcile the search projection from the owning agent-session domain service.

use super::backfill_gate::BackfillGate;
use std::{collections::HashSet, sync::Arc};

use agent_session::domain::{
    events::AgentSessionLifecycleEventName,
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
///
/// Every write carries `version`, and the index refuses a write older than
/// what it holds, so a delayed request from an earlier reconcile cannot
/// overwrite a later one.
pub trait AgentSessionSearchIndex: Send + Sync + 'static {
    /// Writes only the messages the index does not already hold as they are.
    fn reconcile(
        &self,
        snapshot: SearchSnapshot,
        index_override: Option<&str>,
        version: ProjectionVersion,
    ) -> impl Future<Output = Result<ProjectionWrites, Report>> + Send;
    fn delete(
        &self,
        id: AgentSessionId,
        index_override: Option<&str>,
        version: ProjectionVersion,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Orders one session's index writes: each reconcile's version is later than
/// every earlier reconcile's, because it is the time the database granted
/// that reconcile's session lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProjectionVersion(u64);

impl ProjectionVersion {
    /// Microseconds since the epoch at the lease grant.
    pub fn from_grant(granted_at: chrono::DateTime<chrono::Utc>) -> Result<Self, Report> {
        Ok(Self(u64::try_from(granted_at.timestamp_micros())?))
    }

    pub fn get(self) -> u64 {
        self.0
    }
}

/// What one reconcile changed in the index.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProjectionWrites {
    pub parent_written: bool,
    pub messages_written: usize,
    pub messages_unchanged: usize,
    pub messages_deleted: usize,
}

/// Why a session is reconciled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconcileTrigger {
    /// A lifecycle event that may have changed what search reads.
    Lifecycle(AgentSessionLifecycleEventName),
    /// A requested repair.
    Backfill,
}

impl ReconcileTrigger {
    fn name(self) -> &'static str {
        match self {
            Self::Lifecycle(kind) => kind.into(),
            Self::Backfill => "backfill",
        }
    }
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
    #[tracing::instrument(
        err,
        skip(self, index_override, trigger),
        fields(
            trigger = trigger.name(),
            session_found = tracing::field::Empty,
            parent_written = tracing::field::Empty,
            messages_written = tracing::field::Empty,
            messages_unchanged = tracing::field::Empty,
            messages_deleted = tracing::field::Empty,
        )
    )]
    pub async fn reconcile(
        &self,
        id: AgentSessionId,
        index_override: Option<&str>,
        trigger: ReconcileTrigger,
    ) -> Result<(), Report> {
        let lease = self.source.lock(id).await?;
        let version = ProjectionVersion::from_grant(lease.granted_at)?;
        let snapshot = self.source.snapshot(id).await?;
        let span = tracing::Span::current();
        span.record("session_found", snapshot.is_some());
        let Some(snapshot) = snapshot else {
            return self.index.delete(id, index_override, version).await;
        };

        let writes = self
            .index
            .reconcile(snapshot, index_override, version)
            .await?;
        span.record("parent_written", writes.parent_written);
        span.record("messages_written", writes.messages_written);
        span.record("messages_unchanged", writes.messages_unchanged);
        span.record("messages_deleted", writes.messages_deleted);
        Ok(())
    }

    /// Backfill and live events use the same service and cross-process session lease.
    pub async fn backfill(
        &self,
        req: AgentSessionBackfillRequest,
        gate: &BackfillGate,
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
                let _permit = tokio::select! {
                    biased;
                    () = cancel.cancelled() => break,
                    permit = gate.admit() => permit,
                };
                self.reconcile(
                    AgentSessionId::new_from_uuid(id),
                    req.index_override.as_deref(),
                    ReconcileTrigger::Backfill,
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
                    let _permit = tokio::select! {
                        biased;
                        () = cancel.cancelled() => break,
                        permit = gate.admit() => permit,
                    };
                    self.reconcile(
                        AgentSessionId::new_from_uuid(id),
                        req.index_override.as_deref(),
                        ReconcileTrigger::Backfill,
                    )
                    .await
                    .map_err(|e| BackfillError::Reindex(anyhow::anyhow!("{e:#}")))?;
                    after = Some(id);
                    enqueued += 1;
                    progress.add(1).await;
                }
            }
        }
        Ok(BackfillReceipt {
            enqueued,
            ..BackfillReceipt::default()
        })
    }
}
