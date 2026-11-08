//! Stopping a session's permission requests from one of them: what it would
//! take, and making those changes. The live session picks the new policy up
//! when the request is answered (see [`AgentHarnessInner::deliver`]).

use super::*;
use crate::domain::model::PermissionPolicyConfig;
use crate::domain::runtime_bypass::{
    AgentChoiceChange, RuntimeBypassError, RuntimeBypassOffer, RuntimeBypassService,
    SessionPermissionChoice, StoppedAsking, offer,
};

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
> RuntimeBypassService
    for AgentHarnessService<
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
    #[tracing::instrument(
        name = "agent_session.runtime_bypass.offer",
        skip(self),
        fields(agent.session.id = %session, %caller),
        err
    )]
    async fn runtime_bypass_offer(
        &self,
        caller: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> Result<Option<RuntimeBypassOffer>, RuntimeBypassError> {
        Ok(self
            .inner
            .runtime_bypass_offer(caller, session)
            .await?
            .map(|(_, offer)| offer))
    }

    #[tracing::instrument(
        name = "agent_session.runtime_bypass.stop_asking",
        skip(self),
        fields(
            agent.session.id = %session,
            %caller,
            harness = tracing::field::Empty,
            enables_agent_auto_accept = tracing::field::Empty,
            agent_choice = tracing::field::Empty,
        ),
        err
    )]
    async fn stop_asking_on_runtime(
        &self,
        caller: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> Result<StoppedAsking, RuntimeBypassError> {
        let (bot, offer) = self
            .inner
            .runtime_bypass_offer(caller, session)
            .await?
            .ok_or(RuntimeBypassError::Unavailable)?;
        let span = tracing::Span::current();
        span.record("harness", tracing::field::display(offer.harness));
        span.record("enables_agent_auto_accept", offer.enables_agent_auto_accept);

        self.inner
            .runtime_bypass
            .allow_runtime_bypass(caller, offer.harness)
            .await?;

        let agent = if !offer.enables_agent_auto_accept {
            AgentChoiceChange::NotNeeded
        } else {
            match self
                .inner
                .runtime_bypass
                .auto_accept_permissions(caller, bot)
                .await
            {
                Ok(()) => AgentChoiceChange::SetToBypass,
                // The runtime's bypass stays on: it is what the person
                // confirmed, and on its own it lets the agent be set later.
                Err(error) => {
                    tracing::warn!(
                        error = ?error,
                        "runtime bypass is on but the agent could not be set to bypass"
                    );
                    AgentChoiceChange::StillAsks
                }
            }
        };
        span.record("agent_choice", tracing::field::debug(agent));
        Ok(StoppedAsking {
            harness: offer.harness,
            agent,
        })
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
    /// The offer for `session`, with the bot whose agent it may change.
    async fn runtime_bypass_offer(
        &self,
        caller: &MacroUserIdStr<'static>,
        session_id: AgentSessionId,
    ) -> Result<Option<(BotId, RuntimeBypassOffer)>, RuntimeBypassError> {
        let session = self.sessions.get_session(session_id).await?;
        let Some(choice) = self.session_permission_choice(session_id).await? else {
            return Ok(None);
        };
        let Some(facts) = self.runtime_bypass.facts(caller, session.bot_id).await? else {
            return Ok(None);
        };
        Ok(offer(choice, facts).map(|offer| (session.bot_id, offer)))
    }

    /// Whose permission choice `session_id` follows, mirroring
    /// [`Self::permission_policy_for_session`]. `None` when it follows no
    /// choice a runtime's bypass could unlock: a conversation that has not
    /// opened yet, or one adopted on a built-in runtime.
    async fn session_permission_choice(
        &self,
        session_id: AgentSessionId,
    ) -> agent_session::domain::error::Result<Option<SessionPermissionChoice>> {
        if let Some(policy) = &self.conversations
            && policy.is_conversation_session(session_id).await?
            && let Some(store) = &self.conversation_turns
        {
            let adopted = store.settings(session_id).await?;
            return Ok(match adopted.map(|settings| settings.permissions) {
                Some(PermissionPolicyConfig::Persona {
                    harness_allows_bypass: Some(_),
                    auto_accept_permissions,
                    ..
                }) => Some(SessionPermissionChoice::Pinned {
                    auto_accepts: auto_accept_permissions == Some(true),
                }),
                Some(
                    PermissionPolicyConfig::Persona {
                        harness_allows_bypass: None,
                        ..
                    }
                    | PermissionPolicyConfig::Fixed(_),
                )
                | None => None,
            });
        }
        Ok(Some(SessionPermissionChoice::Agent))
    }
}
