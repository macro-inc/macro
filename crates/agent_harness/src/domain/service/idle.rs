//! Releasing what this process holds for a session nobody has used lately.
//!
//! An in-process session keeps its whole conversation, its agent task and a
//! live `agent_session` actor (with a fold of its entire log) in this
//! process. Held for every session touched since boot, that is the memory
//! the process never gets back. A session whose command worker sat idle for
//! [`super::queue::WORKER_IDLE_TIMEOUT`], with no turn running and nothing
//! queued, gives it back here. Its next command finds it disconnected and
//! resumes it from the durable log, exactly as after a restart.

use super::*;

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
    /// Only this process's memory is touched. The actor is closed only for an
    /// in-process session attached here; closing gives back this replica's
    /// claim under its own fence, so a replica that took the session over
    /// keeps its lease. Sessions of other runtimes keep their actors, whose
    /// transports their providers reap. Nothing durable changes beyond the
    /// actor's ordinary `disconnected` frame.
    #[tracing::instrument(
        name = "agent.session.idle_release",
        skip(self),
        fields(
            agent.session.id = %session_id,
            agent.session.idle_release.quiet = tracing::field::Empty,
            agent.session.idle_release.closed_actor = false,
            agent.session.idle_release.released = false,
        )
    )]
    pub(super) async fn release_idle(&self, session_id: AgentSessionId) {
        let quiet = !self.busy.is_pending(session_id)
            && self.queues.list(session_id).is_empty()
            && !self.notification_batches.contains_key(&session_id);
        tracing::Span::current().record("agent.session.idle_release.quiet", quiet);
        if !quiet {
            return;
        }

        if self.sessions.attached_mcp_servers(session_id).is_some() {
            let session = match self.sessions.get_session(session_id).await {
                Ok(session) => session,
                Err(error) => {
                    tracing::warn!(error = ?error, %session_id, "could not read an idle session");
                    return;
                }
            };
            if AgentKind::for_session(session.bot_id, &session.harness) != AgentKind::InMemory {
                return;
            }
            if let Err(error) = self.sessions.close_session(session_id).await {
                tracing::warn!(error = ?error, %session_id, "could not close an idle session's actor");
                return;
            }
            tracing::Span::current().record("agent.session.idle_release.closed_actor", true);
        }

        if let Err(error) = self.containers.release_idle(session_id).await {
            tracing::warn!(error = ?error, %session_id, "could not release an idle session's runtime state");
            return;
        }
        // The next command reloads the durable queue, which another replica
        // may have changed meanwhile.
        self.queues.drop_session(session_id);
        self.hydrated.remove(&session_id);
        tracing::Span::current().record("agent.session.idle_release.released", true);
    }
}
