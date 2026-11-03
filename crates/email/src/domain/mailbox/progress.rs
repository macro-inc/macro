//! Import progress: the per-mailbox health snapshot and import lifecycle
//! events. Telemetry only; nothing here changes what sync does.

use super::{MailboxError, MailboxKey};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// One finished import run of a mailbox's sync generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportCompleted {
    pub mailbox: MailboxKey,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: DateTime<Utc>,
    /// Provider messages stored for the mailbox when the run finished.
    pub messages: i64,
    /// Mail folders the run enumerated.
    pub folders: i64,
}

/// Messages one mailbox imported since the last flush.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MailboxImports {
    pub imported: u32,
    pub last_imported_at: DateTime<Utc>,
}

/// Imports this worker counted, kept in memory so the import path writes
/// nothing extra. The health loop flushes it once a minute.
#[derive(Clone, Default)]
pub struct ImportTally(Arc<Mutex<HashMap<Uuid, MailboxImports>>>);

impl ImportTally {
    pub fn record(&self, link_id: Uuid, at: DateTime<Utc>) {
        let Ok(mut imports) = self.0.lock() else {
            return;
        };
        imports
            .entry(link_id)
            .and_modify(|entry| {
                entry.imported = entry.imported.saturating_add(1);
                entry.last_imported_at = entry.last_imported_at.max(at);
            })
            .or_insert(MailboxImports {
                imported: 1,
                last_imported_at: at,
            });
    }

    fn take(&self) -> HashMap<Uuid, MailboxImports> {
        self.0
            .lock()
            .map(|mut imports| std::mem::take(&mut *imports))
            .unwrap_or_default()
    }

    /// Put back counts whose flush failed, so the next flush carries them.
    fn restore(&self, unflushed: HashMap<Uuid, MailboxImports>) {
        for (link_id, entry) in unflushed {
            let Ok(mut imports) = self.0.lock() else {
                return;
            };
            imports
                .entry(link_id)
                .and_modify(|current| {
                    current.imported = current.imported.saturating_add(entry.imported);
                    current.last_imported_at = current.last_imported_at.max(entry.last_imported_at);
                })
                .or_insert(entry);
        }
    }
}

/// One mailbox's sync backlog, as one health snapshot reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxBacklog {
    pub link_id: Uuid,
    pub sync_generation: i64,
    /// Messages waiting for reconciliation in the current generation.
    pub queued: i64,
    /// Queued messages backed off until a later time.
    pub parked: i64,
    /// Queued messages a worker holds right now.
    pub leased: i64,
    /// How long the longest-waiting claimable message has been due; 0 if none.
    pub oldest_waiting_seconds: i64,
    /// How far away the latest parked message's retry is; 0 if none.
    pub parked_until_max_seconds: i64,
    /// Folder and catalog streams whose initial enumeration is unfinished.
    pub streams_incomplete: i64,
    pub imported_5m: i64,
    /// `None` when nothing was imported in the last day.
    pub seconds_since_last_import: Option<i64>,
    pub sync_active: bool,
    pub needs_reauth: bool,
}

pub trait MailboxProgressRepository: Send + Sync + 'static {
    /// Add imports counted since the last flush to the current minute.
    fn record_imports(
        &self,
        imports: &HashMap<Uuid, MailboxImports>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// One aggregate read: every sync-active Outlook mailbox, and inactive
    /// ones that still have queued work. Also drops import counts older than
    /// a day.
    fn backlogs(&self) -> impl Future<Output = Result<Vec<MailboxBacklog>, MailboxError>> + Send;
}

pub struct MailboxProgressService<R> {
    repo: R,
    tally: ImportTally,
}

impl<R: MailboxProgressRepository> MailboxProgressService<R> {
    /// `tally` is the one the worker's sync service counts imports into.
    pub fn new(repo: R, tally: ImportTally) -> Self {
        Self { repo, tally }
    }

    /// Persist this worker's import counts. Every worker calls this each minute.
    pub async fn flush(&self) -> Result<(), MailboxError> {
        let imports = self.tally.take();
        if imports.is_empty() {
            return Ok(());
        }
        let result = self.repo.record_imports(&imports).await;
        if result.is_err() {
            self.tally.restore(imports);
        }
        result
    }

    /// Log one health snapshot per mailbox. One worker calls this per minute.
    pub async fn report(&self) -> Result<usize, MailboxError> {
        let backlogs = self.repo.backlogs().await?;
        for backlog in &backlogs {
            tracing::info!(
                link_id = %backlog.link_id,
                sync_generation = backlog.sync_generation,
                queued = backlog.queued,
                parked = backlog.parked,
                leased = backlog.leased,
                oldest_waiting_seconds = backlog.oldest_waiting_seconds,
                parked_until_max_seconds = backlog.parked_until_max_seconds,
                streams_incomplete = backlog.streams_incomplete,
                imported_5m = backlog.imported_5m,
                seconds_since_last_import = backlog.seconds_since_last_import,
                sync_active = backlog.sync_active,
                needs_reauth = backlog.needs_reauth,
                "outlook mailbox health"
            );
        }
        Ok(backlogs.len())
    }
}

/// Logged once an import run's last folder and last imported message settle.
pub(super) fn log_import_completed(completed: &ImportCompleted, graph_calls: Option<u64>) {
    let duration_seconds = completed
        .started_at
        .map(|started| (completed.completed_at - started).num_seconds().max(0));
    tracing::info!(
        link_id = %completed.mailbox.link_id,
        sync_generation = completed.mailbox.sync_generation,
        duration_seconds,
        messages = completed.messages,
        folders = completed.folders,
        graph_calls,
        "outlook import completed"
    );
}

/// Logged when a mailbox starts an import run in a sync generation.
pub fn log_import_started(link_id: Uuid, sync_generation: i64) {
    tracing::info!(%link_id, sync_generation, "outlook import started");
}
