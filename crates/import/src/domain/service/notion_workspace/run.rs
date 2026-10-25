//! Keeping a Notion import alive across processes.
//!
//! The process running a plan or a write holds a lease on the user's run and
//! renews it with the heartbeat. A job stops early when the user cancels,
//! when its process shuts down (it then gives the lease up so another
//! process adopts the run at once), or when another process took the run
//! over (its lease lapsed). Runs whose lease lapsed are adopted by the next
//! report read for that user, or by the host's sweeper, and resumed:
//! planning restarts, writing continues from the ledger.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures::FutureExt;
use import_notion::domain::ports::NotionConnections;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use uuid::Uuid;

use super::super::{AbortOnDrop, IMPORT_HEARTBEAT, ImportServiceImpl};
use super::{CANCEL_CHECK_EVERY, write};
use crate::domain::models::{
    AdoptedRun, ImportSource, ImportStatus, NotionDecision, NotionJob, RunStatus,
};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportRepo, NotionPlanRepo, NotionRunRepo, Result,
    SlackWorkspaceSource, WorkspaceWriter, WrittenObjects,
};

#[cfg(test)]
mod test;

/// How long a run stays held without a heartbeat: three missed beats.
pub(super) const LEASE: Duration = Duration::from_secs(IMPORT_HEARTBEAT.as_secs() * 3);
/// How long a run nobody leased (started by code that predates leases) may
/// go untouched before it is adopted.
const STALE_UNLEASED: Duration = Duration::from_secs(LEASE.as_secs() * 3);
/// How often the sweeper looks for runs to adopt.
const SWEEP_EVERY: Duration = Duration::from_secs(60);
/// Runs one sweep adopts at most.
const ADOPT_PER_SWEEP: u16 = 10;
/// Adoptions after which a run is given up on: a job that keeps stopping its
/// process would otherwise restart forever.
const MAX_ADOPTIONS: u16 = 5;
/// What a run given up on, or a write row left behind, says.
pub(super) const IMPORT_STOPPED: &str =
    "The Notion import stopped before it finished. Start it again to pick up what is left.";

/// Why a job stopped before finishing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum Stop {
    /// The user cancelled the import.
    Cancelled,
    /// This process is shutting down; the run was handed over.
    Shutdown,
    /// Another process holds the run now.
    LeaseLost,
}

/// A running job's view of its run: whether, and why, it must stop.
pub(super) struct JobControl {
    reason: OnceLock<Stop>,
    shutdown: CancellationToken,
    stopped: CancellationToken,
    /// Set together with `stopped`, for the write's checkpoints.
    pub cancel: Arc<write::Cancel>,
}

impl JobControl {
    fn new(shutdown: CancellationToken) -> Self {
        Self {
            reason: OnceLock::new(),
            stopped: shutdown.child_token(),
            shutdown,
            cancel: Arc::new(write::Cancel::default()),
        }
    }

    fn stop(&self, reason: Stop) {
        if self.reason.set(reason).is_ok() {
            tracing::info!(reason = reason.as_ref(), "notion import job stopping");
            self.cancel.stop();
            self.stopped.cancel();
        }
    }

    /// Why the job must stop, once it must. Shutdown counts from the moment
    /// it is signalled, before the watcher notices.
    pub fn reason(&self) -> Option<Stop> {
        self.reason
            .get()
            .copied()
            .or_else(|| self.shutdown.is_cancelled().then_some(Stop::Shutdown))
    }

    /// Whether the job stopped without the user asking: what it was doing
    /// belongs to the next process, so it leaves the run and rows alone.
    pub fn handed_over(&self) -> bool {
        matches!(self.reason(), Some(Stop::Shutdown | Stop::LeaseLost))
    }

    /// Resolves once the job must stop.
    pub async fn stopped(&self) {
        self.stopped.cancelled().await;
    }
}

/// A Notion write to resume or start: every object of the plan, for the
/// folder tree and links, and those still to write.
#[derive(Debug, Clone, Default)]
pub(super) struct WriteSet {
    /// The review that approved the plan.
    pub review_id: Uuid,
    /// Every planned object being written, done or not.
    pub all: Vec<write::WriteItem>,
    /// The objects still to write.
    pub pending: Vec<write::WriteItem>,
}

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// Hold the user's run for this process, recording `job` on it.
    pub(super) async fn take_run(
        &self,
        user: &MacroUserIdStr<'static>,
        job: &NotionJob,
    ) -> Result<bool> {
        self.repo
            .take_run(user, self.jobs.instance, LEASE, job)
            .await
    }

    /// Watch the held run for as long as the returned guard lives: renew the
    /// lease, notice a cancel within seconds, and stop on shutdown.
    pub(super) fn hold_run(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> (Arc<JobControl>, AbortOnDrop) {
        let control = Arc::new(JobControl::new(self.jobs.shutdown.clone()));
        let service = self.clone();
        let user = user.clone();
        let watched = Arc::clone(&control);
        let shutdown = self.jobs.shutdown.clone();
        let watch = self.jobs.tracker.spawn(
            async move {
                let start = tokio::time::Instant::now();
                let mut beat = tokio::time::interval_at(start + IMPORT_HEARTBEAT, IMPORT_HEARTBEAT);
                let mut check =
                    tokio::time::interval_at(start + CANCEL_CHECK_EVERY, CANCEL_CHECK_EVERY);
                loop {
                    tokio::select! {
                        () = shutdown.cancelled() => {
                            watched.stop(Stop::Shutdown);
                            return;
                        }
                        _ = check.tick() => {
                            if service.cancelled(&user).await {
                                watched.stop(Stop::Cancelled);
                                return;
                            }
                        }
                        _ = beat.tick() => {
                            match service.repo.renew_lease(&user, service.jobs.instance, LEASE).await {
                                Ok(true) => {}
                                Ok(false) => {
                                    let reason = if service.cancelled(&user).await {
                                        Stop::Cancelled
                                    } else {
                                        tracing::warn!("notion import lease was taken over");
                                        Stop::LeaseLost
                                    };
                                    watched.stop(reason);
                                    return;
                                }
                                Err(error) => {
                                    tracing::warn!(error = ?error, "notion import lease was not renewed");
                                }
                            }
                        }
                    }
                }
            }
            .in_current_span(),
        );
        (control, AbortOnDrop(watch))
    }

    /// Give the run up so another process adopts it straight away.
    pub(super) async fn release_run(&self, user: &MacroUserIdStr<'static>) {
        match self.repo.release_lease(user, self.jobs.instance).await {
            Ok(released) => tracing::info!(released, "notion import handed over"),
            Err(error) => tracing::warn!(error = ?error, "notion import lease was not released"),
        }
    }

    /// Adopt and resume the stalled Notion runs, only `user`'s when given.
    /// Best-effort: a failure is logged and adopts nothing. Returns how many
    /// runs were adopted.
    pub(super) async fn adopt_stalled(&self, user: Option<&MacroUserIdStr<'static>>) -> usize {
        let limit = if user.is_some() { 1 } else { ADOPT_PER_SWEEP };
        let adopted = match self
            .repo
            .adopt_stalled_runs(user, self.jobs.instance, LEASE, STALE_UNLEASED, limit)
            .await
        {
            Ok(adopted) => adopted,
            Err(error) => {
                tracing::warn!(error = ?error, "could not adopt stalled notion imports");
                return 0;
            }
        };
        let count = adopted.len();
        for run in adopted {
            self.resume(run).await;
        }
        count
    }

    /// Adopt stalled Notion imports every [`SWEEP_EVERY`] until `shutdown`,
    /// so an import whose process died finishes even if nobody looks at it.
    pub async fn sweep_stalled_notion_imports(&self, shutdown: CancellationToken) {
        let mut sweep = tokio::time::interval(SWEEP_EVERY);
        loop {
            tokio::select! {
                () = shutdown.cancelled() => return,
                _ = sweep.tick() => {
                    let span = tracing::info_span!("notion_import.sweep", adopted = tracing::field::Empty);
                    let adopted = self.adopt_stalled(None).instrument(span.clone()).await;
                    span.record("adopted", adopted);
                }
            }
        }
    }

    /// Resume an adopted run in the background, or give it up when it has no
    /// job to resume or kept stopping. Boxed: giving up follows up on the
    /// review, which reads the report, which adopts.
    fn resume(&self, run: AdoptedRun) -> futures::future::BoxFuture<'_, ()> {
        let job = match &run.job {
            Some(NotionJob::Plan { .. }) => "plan",
            Some(NotionJob::Write { .. }) => "write",
            None => "none",
        };
        let span = tracing::info_span!(
            "notion_import.adopt",
            user = %run.user,
            status = run.status.as_ref(),
            adoptions = run.adoptions,
            job,
            review_id = tracing::field::Empty,
            pending = tracing::field::Empty,
            done = tracing::field::Empty,
        );
        let user = run.user.clone();
        async move {
            match run.job {
                Some(NotionJob::Plan { scope, sharing }) if run.adoptions <= MAX_ADOPTIONS => {
                    let service = self.clone();
                    self.jobs.tracker.spawn(
                        async move { service.plan_workspace(&user, scope, sharing).await }
                            .in_current_span(),
                    );
                }
                Some(NotionJob::Write { review_id }) if run.adoptions <= MAX_ADOPTIONS => {
                    tracing::Span::current().record("review_id", tracing::field::display(review_id));
                    match self.resumable_write(&user, review_id).await {
                        Ok(set) => {
                            let span = tracing::Span::current();
                            span.record("pending", set.pending.len());
                            span.record("done", set.all.len() - set.pending.len());
                            let service = self.clone();
                            self.jobs.tracker.spawn(
                                async move { service.write_plan(&user, set).await }
                                    .in_current_span(),
                            );
                        }
                        Err(error) => {
                            tracing::warn!(error = ?error, "could not read the notion write to resume");
                            self.give_up(&user, run.status).await;
                        }
                    }
                }
                _ => self.give_up(&user, run.status).await,
            }
        }
        .instrument(span)
        .boxed()
    }

    /// Fail a run that cannot be resumed and send its rows back to staged.
    /// A write given up on ends like any other, so its session hears of it.
    async fn give_up(&self, user: &MacroUserIdStr<'static>, status: RunStatus) {
        tracing::warn!("giving up on a stalled notion import");
        let failed = match status {
            RunStatus::Importing => {
                self.end_write(user, RunStatus::Failed, Some(IMPORT_STOPPED))
                    .await
            }
            _ => {
                self.repo
                    .transition_run(
                        user,
                        ImportSource::Notion,
                        &[status],
                        RunStatus::Failed,
                        Some(IMPORT_STOPPED),
                    )
                    .await
            }
        };
        if let Err(error) = failed {
            tracing::warn!(error = ?error, "could not fail the stalled notion import");
        }
        let _ = self.repo.settle_importing(user, IMPORT_STOPPED).await;
        self.notify(user).await;
    }

    /// The write for `review_id` as the ledger has it: the plan's copied
    /// objects, and those still `importing`.
    async fn resumable_write(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
    ) -> Result<WriteSet> {
        let rows = self
            .repo
            .list(user, Some(ImportSource::Notion), None)
            .await?;
        let mut set = WriteSet {
            review_id,
            ..WriteSet::default()
        };
        for row in rows.iter().filter(|row| {
            row.review_id == Some(review_id)
                && row.user_id == user.as_ref()
                && row.status != ImportStatus::Discarded
        }) {
            let Some(item) = write::WriteItem::from_entity(row) else {
                continue;
            };
            if !matches!(item.decision, NotionDecision::Copy | NotionDecision::Tasks) {
                continue;
            }
            if row.status == ImportStatus::Importing {
                set.pending.push(item.clone());
            }
            set.all.push(item);
        }
        Ok(set)
    }
}
