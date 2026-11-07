//! Archiving a session when the runtime session backing it is deliberately
//! closed, as the session actor reports through its turn observer.

use std::sync::Arc;

use agent_fold::domain::model::TurnSignal;
use agent_session::domain::auto_archive::AutoArchive;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::SessionTurnObserver;
use agent_session::domain::session::StopReason;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// A [`SessionTurnObserver`] that hands each deliberate runtime close to
/// [`AutoArchive::runtime_closed`], which archives the session only when its
/// owner opted in and it is idle. Turn signals and disconnects are ignored:
/// a disconnected session stays visible.
pub struct ArchiveOnRuntimeClosed<Archive> {
    archive: Arc<Archive>,
    tasks: TaskTracker,
}

impl<Archive> ArchiveOnRuntimeClosed<Archive> {
    /// Archive through `archive`, on tasks tracked by `tasks`.
    pub fn new(archive: Archive, tasks: TaskTracker) -> Self {
        Self {
            archive: Arc::new(archive),
            tasks,
        }
    }
}

impl<Archive: AutoArchive> SessionTurnObserver for ArchiveOnRuntimeClosed<Archive> {
    fn signal(&self, _id: AgentSessionId, _signal: TurnSignal) {}

    fn session_stopped(&self, _id: AgentSessionId, _reason: StopReason) {}

    /// Off the actor's task: the archive reads and writes the session row.
    /// `runtime_closed` traces its own failure, and a failed archive leaves
    /// the session as it was, so nothing else handles it here.
    fn runtime_closed(&self, id: AgentSessionId) {
        let archive = Arc::clone(&self.archive);
        self.tasks.spawn(
            async move {
                let _ = archive.runtime_closed(id).await;
            }
            .in_current_span(),
        );
    }
}
