//! Publishing a session's lifecycle facts: who the session is.

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::events::{
    AgentSessionLifecycleEvent, SessionIdentity, SessionMentionedMetadata, SessionOpenedMetadata,
};
use agent_session::domain::lifecycle::session_identity;

use crate::domain::notifications::plan;
use macro_user_id::user_id::MacroUserIdStr;

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
    PromptContext: ChannelPromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
{
    /// The identity block for one session, from its row and its bot.
    pub(super) async fn identity(&self, session_id: AgentSessionId) -> Result<SessionIdentity> {
        let session = self.sessions.get_session(session_id).await?;
        self.identity_of(&session).await
    }

    /// The identity block for a session whose row is already in hand.
    pub(super) async fn identity_of(&self, session: &AgentSession) -> Result<SessionIdentity> {
        let (bot, participants) = tokio::try_join!(
            self.sessions.session_bot(session.bot_id),
            self.sessions.session_participants(session.id),
        )?;
        Ok(session_identity(session, &bot, participants))
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
        match self.identity(session_id).await {
            Ok(identity) => {
                let event = build(identity);
                let notifications = plan(&event);
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

    /// Share the session with the users a prompt names and publish
    /// `agent_session.mentioned` for them, if any.
    ///
    /// The author is never in the list: mentioning yourself is not news. Like
    /// every lifecycle publish, a failure to resolve the mentions is logged
    /// and the prompt goes on regardless - the mention is a courtesy to
    /// whoever was named, not part of delivering the prompt.
    pub(super) async fn publish_mentions(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
        actor: Option<MacroUserIdStr<'static>>,
        prompt_markdown: &str,
    ) {
        let mentioned = match self
            .mentions
            .share_with_mentioned(session_id, actor.as_ref(), prompt_markdown)
            .await
        {
            Ok(mentioned) => mentioned,
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    %session_id,
                    "skipping agent_session.mentioned: mentions unavailable"
                );
                return;
            }
        };
        let mentioned: Vec<_> = mentioned
            .into_iter()
            .filter(|user| actor.as_ref() != Some(user))
            .collect();
        if mentioned.is_empty() {
            return;
        }
        self.publish_lifecycle(session_id, |identity| {
            AgentSessionLifecycleEvent::Mentioned(SessionMentionedMetadata {
                identity,
                action_id,
                mentioned_by: actor,
                mentioned,
            })
        })
        .await;
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
