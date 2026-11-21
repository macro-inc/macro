//! The session's background jobs, listed in each prompt it dispatches so the
//! agent can say what still runs and what ended.

use std::{future::Future, pin::Pin};

use super::*;
use agent_runtime_protocol::domain::job::BackgroundJobSummary;

/// The background jobs a session's agent started.
pub trait BackgroundJobs: Send + Sync + 'static {
    /// Running jobs and recently settled ones, newest first.
    fn listing(
        &self,
        session: AgentSessionId,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<BackgroundJobSummary>>> + Send + '_>>;
}

/// Longest a prompt waits for its session's job list.
const LISTING_LIMIT: std::time::Duration = std::time::Duration::from_secs(2);

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
    /// Put the session's job list on a prompt about to dispatch. A list that
    /// can't be read leaves the prompt without one: the prompt still runs.
    pub(super) async fn attach_background_jobs(
        &self,
        session_id: AgentSessionId,
        action: &mut AgentAction,
    ) {
        let (Some(jobs), AgentAction::Prompt(prompt)) = (&self.background_jobs, action) else {
            return;
        };
        // A read that stalls must not hold the prompt either.
        match tokio::time::timeout(LISTING_LIMIT, jobs.listing(session_id)).await {
            Ok(Ok(listing)) => prompt.background_jobs = listing,
            Ok(Err(error)) => {
                tracing::warn!(?error, %session_id, "could not list the session's background jobs");
            }
            Err(_) => {
                tracing::warn!(%session_id, "listing the session's background jobs timed out");
            }
        }
    }
}
