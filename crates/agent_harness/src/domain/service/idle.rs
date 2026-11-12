//! Releasing what this process holds for a session nobody has used lately.
//!
//! An in-process session keeps its whole conversation, its agent task and a
//! live `agent_session` actor (with a fold of its entire log) in this
//! process. Held for every session touched since boot, that is the memory
//! the process never gets back. A session whose command worker sat idle for
//! [`super::queue::WORKER_IDLE_TIMEOUT`], with no turn running and nothing
//! queued, gives it back here, silently: nothing is written to its log,
//! nothing is published, and no lifecycle event or webhook goes out. Its next
//! command finds no actor and resumes it from the durable log.

use std::{future::Future, pin::Pin};

use super::*;
use agent_session::domain::model::SessionRelease;

/// PostHog kill switch: on for a session's owner, a release that kept the
/// session is not tried again and its worker retires, as before retries
/// existed. Missing or unreadable flags keep retrying.
pub const IDLE_RELEASE_NO_RETRY_FLAG: &str = "disable-agent-idle-release-retry";

/// Whether an idle release that kept `owner`'s session is tried again.
pub(super) trait IdleReleaseRetry: Send + Sync {
    fn retries<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

/// Reads [`IDLE_RELEASE_NO_RETRY_FLAG`].
pub(super) struct FlaggedIdleReleaseRetry<F>(pub(super) F);

impl<F: FeatureFlags> IdleReleaseRetry for FlaggedIdleReleaseRetry<F> {
    fn retries<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            match self.0.load(owner).await {
                Ok(flags) => !flags.is_enabled(IDLE_RELEASE_NO_RETRY_FLAG),
                Err(error) => {
                    tracing::warn!(?error, "feature flags unavailable; retrying idle release");
                    true
                }
            }
        })
    }
}

/// What an idle session's release came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum IdleRelease {
    /// This process holds nothing for the session anymore.
    Released,
    /// A command, queued action or notification batch is open.
    NotQuiet,
    /// The log would rebuild a different conversation than the live one.
    NotLossless,
    /// The session runs on a runtime whose provider reaps it; nothing here
    /// to free.
    OtherRuntime,
    /// The actor had work open.
    Busy,
    /// The actor went away between the checks.
    NotAttached,
    /// A read or the release itself failed.
    Failed,
}

impl IdleRelease {
    /// Whether the session's worker may retire: nothing it could still free
    /// is held here. Otherwise it stays to try again, or the session is held
    /// until its next command, which may never come.
    pub(super) fn holds_nothing(self) -> bool {
        matches!(self, Self::Released | Self::OtherRuntime)
    }

    /// Whether the next try waits longer. Only a try that read and replayed
    /// the log, or failed, does: a session kept for a running turn or an
    /// actor mid-work is tried again at the plain timeout, so it is released
    /// soon after its work ends.
    pub(super) fn backs_off(self) -> bool {
        matches!(self, Self::NotLossless | Self::Failed)
    }
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
    AgentHarnessInner<
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
    /// Release `session_id`'s local state if it is quiet. Runs on the
    /// session's own command worker, so no command for it is running, and
    /// one arriving meanwhile waits behind this and reconnects.
    ///
    /// Quiet means no command admitted and unresolved (which covers a running
    /// turn, a held tool call and a question waiting for its answer), nothing
    /// in its queue and no notification batch bound to it.
    ///
    /// The runtime must also say the release is lossless: what a resume would
    /// rebuild from the log is exactly what the agent runs on now.
    ///
    /// Only this process's memory is touched. The actor of an in-process
    /// session attached here is released with
    /// [`AgentSessionService::release_session`]: no log frame, no stopped
    /// callback, and this replica's claim given back under its own fence, so
    /// a replica that took the session over keeps its lease and its turns.
    /// Sessions of other runtimes keep their actors, whose transports their
    /// providers reap.
    ///
    /// `attempt` counts the earlier tries this worker made since the
    /// session's last command; the caller backs off on what this answers.
    #[tracing::instrument(
        name = "agent.session.idle_release",
        skip(self),
        fields(
            agent.session.id = %session_id,
            agent.session.idle_release.attempt = attempt,
            agent.session.idle_release.quiet = tracing::field::Empty,
            agent.session.idle_release.lossless = tracing::field::Empty,
            agent.session.idle_release.closed_actor = tracing::field::Empty,
            agent.session.idle_release.released = tracing::field::Empty,
            agent.session.idle_release.outcome = tracing::field::Empty,
        )
    )]
    pub(super) async fn release_idle(
        &self,
        session_id: AgentSessionId,
        attempt: u32,
    ) -> IdleRelease {
        let span = tracing::Span::current();
        let quiet = !self.busy.is_pending(session_id)
            && self.queues.list(session_id).is_empty()
            && !self.notification_batches.contains_key(&session_id);
        span.record("agent.session.idle_release.quiet", quiet);
        let (outcome, closed_actor) = if quiet {
            self.release_quiet(session_id).await
        } else {
            (IdleRelease::NotQuiet, false)
        };
        span.record("agent.session.idle_release.closed_actor", closed_actor);
        span.record(
            "agent.session.idle_release.released",
            outcome == IdleRelease::Released,
        );
        span.record("agent.session.idle_release.outcome", <&str>::from(outcome));
        outcome
    }

    /// Whether a release that kept `session_id` is tried again, or its worker
    /// retires ([`IDLE_RELEASE_NO_RETRY_FLAG`]).
    pub(super) async fn retries_idle_release(&self, session_id: AgentSessionId) -> bool {
        let Some(retry) = &self.idle_release_retry else {
            return true;
        };
        match self.sessions.get_session(session_id).await {
            Ok(AgentSession {
                owner_id: model_owner::Owner::User(owner),
                ..
            }) => retry.retries(&owner).await,
            _ => true,
        }
    }

    /// The release of a quiet session, and whether its actor was closed.
    async fn release_quiet(&self, session_id: AgentSessionId) -> (IdleRelease, bool) {
        let attached = self.sessions.attached_mcp_servers(session_id).is_some();
        // What this process holds for a session another replica manages, with
        // no actor here, is a copy left from before the takeover. The log has
        // moved past it, so it is never right to reuse: drop it as it is.
        let left_behind = !attached
            && matches!(
                self.sessions.management(session_id).await,
                Ok(SessionManagement::Peer(_))
            );
        // Otherwise asked before anything is closed: a session that would
        // come back different from its log keeps everything.
        if !left_behind {
            let lossless = match self.containers.idle_release_is_lossless(session_id).await {
                Ok(lossless) => lossless,
                Err(error) => {
                    tracing::warn!(error = ?error, %session_id, "could not check an idle session's rebuild");
                    return (IdleRelease::Failed, false);
                }
            };
            tracing::Span::current().record("agent.session.idle_release.lossless", lossless);
            if !lossless {
                return (IdleRelease::NotLossless, false);
            }
        }

        let mut closed_actor = false;
        if attached {
            // A session whose row is gone is closed whatever ran it: no
            // provider reaps the transport of a session that no longer exists.
            let in_memory = match self.sessions.get_session(session_id).await {
                Ok(session) => {
                    AgentKind::for_session(session.bot_id, &session.harness) == AgentKind::InMemory
                }
                Err(AgentSessionError::NotFound(_)) => true,
                Err(error) => {
                    tracing::warn!(error = ?error, %session_id, "could not read an idle session");
                    return (IdleRelease::Failed, false);
                }
            };
            if !in_memory {
                return (IdleRelease::OtherRuntime, false);
            }
            match self.sessions.release_session(session_id).await {
                Ok(SessionRelease::Released) => closed_actor = true,
                // The actor still has work open, or is already gone: leave
                // the runtime state to whoever is using or rebuilding it.
                Ok(SessionRelease::Busy) => return (IdleRelease::Busy, false),
                Ok(SessionRelease::NotAttached) => return (IdleRelease::NotAttached, false),
                Err(error) => {
                    tracing::warn!(error = ?error, %session_id, "could not release an idle session's actor");
                    return (IdleRelease::Failed, false);
                }
            }
        }

        if let Err(error) = self.containers.release_idle(session_id).await {
            tracing::warn!(error = ?error, %session_id, "could not release an idle session's runtime state");
            return (IdleRelease::Failed, closed_actor);
        }
        // The next command reloads the durable queue, which another replica
        // may have changed meanwhile.
        self.queues.drop_session(session_id);
        self.hydrated.remove(&session_id);
        (IdleRelease::Released, closed_actor)
    }
}
