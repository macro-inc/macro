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

use agent_session::domain::model::SessionRelease;

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
    #[tracing::instrument(
        name = "agent.session.idle_release",
        skip(self),
        fields(
            agent.session.id = %session_id,
            agent.session.idle_release.quiet = tracing::field::Empty,
            agent.session.idle_release.lossless = tracing::field::Empty,
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
            match self.containers.idle_release_is_lossless(session_id).await {
                Ok(true) => {}
                Ok(false) => {
                    tracing::Span::current().record("agent.session.idle_release.lossless", false);
                    return;
                }
                Err(error) => {
                    tracing::warn!(error = ?error, %session_id, "could not check an idle session's rebuild");
                    return;
                }
            }
        }

        if attached {
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
            match self.sessions.release_session(session_id).await {
                Ok(SessionRelease::Released) => {
                    tracing::Span::current()
                        .record("agent.session.idle_release.closed_actor", true);
                }
                // The actor still has work open, or is already gone: leave
                // the runtime state to whoever is using or rebuilding it.
                Ok(SessionRelease::Busy | SessionRelease::NotAttached) => return,
                Err(error) => {
                    tracing::warn!(error = ?error, %session_id, "could not release an idle session's actor");
                    return;
                }
            }
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
