//! Publishing a session's lifecycle facts: who the session is.

use agent_session::domain::events::{
    AgentSessionLifecycleEvent, SessionIdentity, SessionOpenedMetadata,
};
use agent_session::domain::lifecycle::session_identity;

use crate::domain::model::{ReplyPersona, is_coding_agent};
use crate::domain::notifications::plan;

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
    Notifier: AgentSessionNotifier,
{
    /// The identity block for one session, from its row and its bot.
    pub(super) async fn identity(&self, session_id: AgentSessionId) -> Result<SessionIdentity> {
        let session = self.sessions.get_session(session_id).await?;
        self.identity_of(&session).await
    }

    /// [`Self::identity`], with whether the session's bot is a coding agent
    /// and whether it runs out of sight - read together because the
    /// notifications a fact warrants depend on all three.
    pub(super) async fn identity_and_coding(
        &self,
        session_id: AgentSessionId,
    ) -> Result<(SessionIdentity, bool, bool)> {
        let session = self.sessions.get_session(session_id).await?;
        let (identity, persona) =
            tokio::try_join!(self.identity_of(&session), self.reply_persona(&session))?;
        let is_dm = match &self.conversations {
            Some(policy) => policy.is_conversation_session(session_id).await?,
            None => false,
        };
        Ok((
            identity,
            !is_dm && persona.is_coding,
            session.is_background(),
        ))
    }

    /// The persona a session's thread replies speak as: its bot's name, and
    /// the bot's choice of being a coding agent applied to the runtime the
    /// row names.
    pub(super) async fn reply_persona(&self, session: &AgentSession) -> Result<ReplyPersona> {
        let (bot, choice) = tokio::try_join!(
            async { Ok::<_, HarnessError>(self.sessions.session_bot(session.bot_id).await?) },
            async {
                self.coding_agents
                    .coding_agent_choice(session.bot_id)
                    .await
                    .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))
            },
        )?;
        Ok(ReplyPersona {
            name: bot.name,
            is_coding: is_coding_agent(
                choice,
                AgentKind::for_session(session.bot_id, &session.harness),
            ),
        })
    }

    /// The identity block for a session whose row is already in hand.
    pub(super) async fn identity_of(&self, session: &AgentSession) -> Result<SessionIdentity> {
        let (bot, participants) = tokio::try_join!(
            self.sessions.session_bot(session.bot_id),
            self.sessions.session_participants(session.id),
        )?;
        Ok(session_identity(session, &bot, participants)?)
    }

    /// Publish one fact about `session_id`, built once its identity is known,
    /// then send whoever it is news to their notification.
    ///
    /// Never fails the command it rides on: a session whose identity cannot be
    /// loaded is logged and skipped, because the fact itself already happened.
    /// The notifications are derived from the very event that was published,
    /// so the two cannot disagree.
    pub(super) async fn publish_lifecycle(
        &self,
        session_id: AgentSessionId,
        build: impl FnOnce(SessionIdentity) -> AgentSessionLifecycleEvent,
    ) {
        match self.identity_and_coding(session_id).await {
            Ok((identity, is_coding, background)) => {
                let event = build(identity);
                // Nobody can open a background session, so nothing about it
                // is news to anyone; whoever asked reads its result elsewhere.
                let notifications = if background {
                    Vec::new()
                } else {
                    plan(&event, is_coding)
                };
                self.lifecycle_publisher.publish(event).await;
                for notification in notifications {
                    self.notifier.notify(notification).await;
                }
            }
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
