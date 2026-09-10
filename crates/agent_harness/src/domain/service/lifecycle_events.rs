//! Publishing a session's lifecycle facts: who the session is.

use agent_session::domain::events::{
    AgentSessionLifecycleEvent, SessionIdentity, SessionOpenedMetadata,
};
use agent_session::domain::lifecycle::session_identity;

use super::*;

impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    AgentHarnessInner<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: ChannelPromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
{
    /// The identity block for one session, from its row and its bot.
    pub(super) async fn identity(&self, session_id: AgentSessionId) -> Result<SessionIdentity> {
        let session = self.sessions.get_session(session_id).await?;
        self.identity_of(&session).await
    }

    /// The identity block for a session whose row is already in hand.
    pub(super) async fn identity_of(&self, session: &AgentSession) -> Result<SessionIdentity> {
        let bot = self.sessions.session_bot(session.bot_id).await?;
        Ok(session_identity(session, &bot))
    }

    /// Publish one fact about `session_id`, built once its identity is known.
    ///
    /// Never fails the command it rides on: a session whose identity cannot be
    /// loaded is logged and skipped, because the fact itself already happened.
    pub(super) async fn publish_lifecycle(
        &self,
        session_id: AgentSessionId,
        build: impl FnOnce(SessionIdentity) -> AgentSessionLifecycleEvent,
    ) {
        match self.identity(session_id).await {
            Ok(identity) => self.lifecycle_publisher.publish(build(identity)).await,
            Err(error) => tracing::warn!(
                error = ?error,
                %session_id,
                "skipping agent session lifecycle event: identity unavailable"
            ),
        }
    }

    /// Publish `agent_session.opened` for a row just created.
    pub(super) async fn publish_opened(&self, session: &AgentSession) {
        match self.identity_of(session).await {
            Ok(identity) => {
                self.lifecycle_publisher
                    .publish(AgentSessionLifecycleEvent::Opened(SessionOpenedMetadata {
                        identity,
                        model: session.model.clone(),
                        harness: session.harness.clone(),
                    }))
                    .await;
            }
            Err(error) => tracing::warn!(
                error = ?error,
                session_id = %session.id,
                "skipping agent_session.opened: identity unavailable"
            ),
        }
    }
}
