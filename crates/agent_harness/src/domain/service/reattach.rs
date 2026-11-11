//! Restoring the sessions a runtime still serves when it dials in again.
//!
//! A runtime can list hundreds of sessions, and it redials whenever its
//! socket drops, so a dial must never stampede the replica: dormant sessions
//! cost it nothing, idle sessions wait for their next prompt, every dial on
//! this replica shares [`REATTACH_CONCURRENCY`] permits, each held until the
//! session's ACP restore finishes, and a harness dialing again stops its
//! previous dial from starting more (restores already running finish under
//! their permit).

use super::deliver::DialReattach;
use super::*;
use agent_client_protocol::schema::v1::SessionId;
use agent_session::domain::connection::ListedSession;
use futures::StreamExt as _;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio_util::sync::CancellationToken;

/// How many sessions this replica attaches and restores at once, across
/// every dial. An attach claims the session and provisions its egress, and
/// its restore replays history over the runtime's socket.
pub(crate) const REATTACH_CONCURRENCY: usize = 8;
/// How many times a dial tries to restore one session.
const REATTACH_ATTEMPTS: u32 = 3;
/// The delay before the first retry, doubled for each later one, plus up to
/// as much again in jitter so a runtime's sessions do not retry in step.
const REATTACH_RETRY_BASE: std::time::Duration = std::time::Duration::from_secs(2);

/// Numbers dials so a finished dial only forgets itself, not a newer one.
static DIAL_GENERATION: AtomicU64 = AtomicU64::new(0);

/// One harness's dial in progress.
pub(super) struct Dial {
    generation: u64,
    cancelled: CancellationToken,
}

/// What one dial did with the sessions its runtime listed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReattachReport {
    /// Restored now: attached and their ACP session reopened.
    pub eager: usize,
    /// Left to bind on their next prompt or delivery.
    pub lazy: usize,
    /// Dormant (see [`crate::domain::model::ListedSessions::dormant`]): left
    /// to their next prompt or delivery without any per-session work.
    pub dormant: usize,
    /// Archived, or not an external session.
    pub skipped: usize,
    /// Not restored after every attempt this dial allowed.
    pub failed: usize,
    /// Not started, or not retried, because the harness disconnected or
    /// dialed again.
    pub abandoned: usize,
    /// Attempts beyond each session's first.
    pub retries: u32,
}

/// What a dial did with one listed session.
enum Outcome {
    Restored,
    Lazy,
    Skipped,
    Failed,
    Abandoned,
}

/// Whether retrying cannot help: the session is gone, refused, archived,
/// held by another replica, or its bot is no longer served by this runtime.
fn is_permanent(error: &HarnessError) -> bool {
    matches!(
        error,
        HarnessError::Disconnected(_)
            | HarnessError::Session(
                AgentSessionError::NotFound(_)
                    | AgentSessionError::Forbidden
                    | AgentSessionError::Archived(_)
                    | AgentSessionError::Disconnected(_)
                    | AgentSessionError::ManagedElsewhere(_)
                    | AgentSessionError::Draining(_)
            )
    )
}

impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
>
    AgentHarnessService<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: MessagePromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
{
    /// Load the sessions a runtime that dialed in again still serves.
    ///
    /// Only sessions whose bot is bound to `harness` are touched, each on its
    /// own command worker, so a reattach waits behind whatever that session
    /// is already doing. Which sessions are restored now is `dial_reattach`'s
    /// call, which reads each session's `updated_at` from the listing. A
    /// failed restore is retried with jittered backoff unless retrying cannot
    /// help. One session failing never stops the others.
    #[tracing::instrument(
        name = "agent.runtime.reattach",
        skip_all,
        fields(
            %harness,
            agent.runtime.live_sessions = acp_sessions.len(),
            agent.runtime.reattach_sessions = tracing::field::Empty,
            agent.runtime.reattach_eager = tracing::field::Empty,
            agent.runtime.reattach_lazy = tracing::field::Empty,
            agent.runtime.reattach_dormant = tracing::field::Empty,
            agent.runtime.reattach_skipped = tracing::field::Empty,
            agent.runtime.reattach_failures = tracing::field::Empty,
            agent.runtime.reattach_abandoned = tracing::field::Empty,
            agent.runtime.reattach_retries = tracing::field::Empty,
        )
    )]
    pub async fn reattach_live_sessions(
        &self,
        harness: harness_id::HarnessId,
        acp_sessions: Vec<ListedSession>,
        cause: tracing::Span,
    ) -> ReattachReport {
        tracing::Span::current().follows_from(&cause);
        let generation = DIAL_GENERATION.fetch_add(1, Ordering::Relaxed);
        let cancelled = CancellationToken::new();
        if let Some(previous) = self.inner.dials.insert(
            harness,
            Dial {
                generation,
                cancelled: cancelled.clone(),
            },
        ) {
            previous.cancelled.cancel();
        }

        let report = self
            .reattach_listed(harness, acp_sessions, &cancelled)
            .await;
        self.inner
            .dials
            .remove_if(&harness, |_, dial| dial.generation == generation);

        let span = tracing::Span::current();
        span.record("agent.runtime.reattach_eager", report.eager);
        span.record("agent.runtime.reattach_lazy", report.lazy);
        span.record("agent.runtime.reattach_dormant", report.dormant);
        span.record("agent.runtime.reattach_skipped", report.skipped);
        span.record("agent.runtime.reattach_failures", report.failed);
        span.record("agent.runtime.reattach_abandoned", report.abandoned);
        span.record("agent.runtime.reattach_retries", report.retries);
        report
    }

    async fn reattach_listed(
        &self,
        harness: harness_id::HarnessId,
        acp_sessions: Vec<ListedSession>,
        cancelled: &CancellationToken,
    ) -> ReattachReport {
        let ids: Vec<SessionId> = acp_sessions
            .iter()
            .map(|listed| listed.id.clone())
            .collect();
        let runtime_activity: HashMap<SessionId, chrono::DateTime<chrono::Utc>> = acp_sessions
            .into_iter()
            .filter_map(|listed| Some((listed.id, listed.updated_at?)))
            .collect();
        let listed = match self.inner.runtimes.sessions_on_harness(harness, &ids).await {
            Ok(listed) => listed,
            Err(error) => {
                tracing::error!(error = ?error, "could not resolve a runtime's live sessions");
                return ReattachReport::default();
            }
        };
        tracing::Span::current().record("agent.runtime.reattach_sessions", listed.live.len());

        let outcomes: Vec<(Outcome, u32)> = futures::stream::iter(listed.live)
            .map(|session_id| {
                self.reattach_live_session(harness, session_id, &runtime_activity, cancelled)
            })
            .buffer_unordered(REATTACH_CONCURRENCY)
            .collect()
            .await;

        let mut report = ReattachReport {
            dormant: listed.dormant,
            ..ReattachReport::default()
        };
        for (outcome, retries) in outcomes {
            report.retries += retries;
            match outcome {
                Outcome::Restored => report.eager += 1,
                Outcome::Lazy => report.lazy += 1,
                Outcome::Skipped => report.skipped += 1,
                Outcome::Failed => report.failed += 1,
                Outcome::Abandoned => report.abandoned += 1,
            }
        }
        report
    }

    /// Restore one listed session if it needs it now, with how many times
    /// it was retried.
    async fn reattach_live_session(
        &self,
        harness: harness_id::HarnessId,
        session_id: AgentSessionId,
        runtime_activity: &HashMap<SessionId, chrono::DateTime<chrono::Utc>>,
        cancelled: &CancellationToken,
    ) -> (Outcome, u32) {
        if cancelled.is_cancelled() || !self.inner.runtimes.is_connected(harness) {
            return (Outcome::Abandoned, 0);
        }
        match self.inner.dial_reattach(session_id, runtime_activity).await {
            Ok(DialReattach::Eager) => {}
            Ok(DialReattach::Lazy) => return (Outcome::Lazy, 0),
            Ok(DialReattach::Skip) => return (Outcome::Skipped, 0),
            Err(error) => {
                tracing::warn!(error = ?error, %session_id, "could not decide whether to reattach a live session");
                return (Outcome::Failed, 0);
            }
        }

        let mut delay = REATTACH_RETRY_BASE;
        let mut retries = 0;
        loop {
            // Cancelling the dial stops it from starting a restore, never
            // from waiting for one: the Reattach runs on the session's worker
            // whatever happens to this future, so its permit stays held until
            // the restore is done.
            let permit = tokio::select! {
                () = cancelled.cancelled() => return (Outcome::Abandoned, retries),
                permit = self.inner.reattach_permits.acquire() => permit,
            };
            let Ok(_permit) = permit else {
                return (Outcome::Abandoned, retries);
            };
            let attempt = self.restore(session_id).await;
            drop(_permit);
            let Err(error) = attempt else {
                return (Outcome::Restored, retries);
            };
            tracing::warn!(error = ?error, %session_id, retries, "could not reattach a live session");
            if is_permanent(&error) || retries + 1 == REATTACH_ATTEMPTS {
                return (Outcome::Failed, retries);
            }
            if cancelled.is_cancelled() || !self.inner.runtimes.is_connected(harness) {
                return (Outcome::Abandoned, retries);
            }
            let jitter = delay.mul_f64(rand::random::<f64>());
            tokio::select! {
                () = cancelled.cancelled() => return (Outcome::Abandoned, retries),
                () = tokio::time::sleep(delay + jitter) => {}
            }
            delay *= 2;
            retries += 1;
        }
    }

    /// Attach the session on its own worker and wait for its ACP restore.
    async fn restore(&self, session_id: AgentSessionId) -> Result<()> {
        self.execute(session_id, HarnessCommand::Reattach).await?;
        match self.inner.sessions.wait_opened(session_id).await {
            Ok(true) => Ok(()),
            Ok(false) | Err(_) => Err(HarnessError::Handshake(
                "the runtime did not restore the session".to_owned(),
            )),
        }
    }
}
