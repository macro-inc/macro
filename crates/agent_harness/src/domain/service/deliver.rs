//! Delivering one queued action to the running agent: announce it in the
//! channel, compose it with channel context, and prompt the runtime.

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
    /// Deliver one already-composed action to the session's runtime.
    ///
    /// Announcing and composition are not this function's business: both
    /// belong to dispatch (see [`Self::dispatch_next`]), which is the only
    /// path a turn-occupying prompt travels. Non-turn-occupying actions
    /// (set-model, stop) arrive here directly and need neither.
    #[tracing::instrument(err, skip(self, command), fields(agent.session.id = %session_id))]
    pub(super) async fn deliver(
        &self,
        session_id: AgentSessionId,
        command: DeliverAction,
    ) -> Result<()> {
        let DeliverAction {
            id,
            action,
            actor,
            announce: _,
        } = command;

        match self
            .sessions
            .send_action(session_id, actor.clone(), action.clone(), id)
            .await
        {
            Ok(()) => {}
            // Nothing is attached, so get this session onto a transport and
            // retry against it. Same id: the first attempt never reached the
            // wire.
            Err(AgentSessionError::Disconnected(_)) => {
                let session = self.sessions.get_session(session_id).await?;
                if AgentKind::for_session(session.bot_id, &session.harness).is_managed() {
                    let container = self.containers.resume(session_id).await?;
                    let mcp_servers = self
                        .resumed_mcp_servers(session_id, &session.owner_id, &session.mcp_servers)
                        .await?;
                    self.sessions
                        .attach_session(
                            session_id,
                            RuntimeAttachment::solo(container).mcp_servers(mcp_servers),
                        )
                        .await?;
                } else {
                    // An external runtime is not ours to start - only its
                    // operator can dial - but a bot whose runtime is already
                    // connected just has not had this session bound to it
                    // yet. That is the ordinary case: sessions bind when they
                    // are prompted, not when the runtime dials, so the first
                    // prompt after a reconnect is what restores the session.
                    let Some(attachment) = self.runtimes.bind(session.bot_id, session_id).await
                    else {
                        // Kept in the session vocabulary so transports report
                        // it as a disconnect, not an internal error.
                        return Err(HarnessError::Session(AgentSessionError::Disconnected(
                            session_id,
                        )));
                    };
                    self.sessions.attach_session(session_id, attachment).await?;
                }
                self.sessions
                    .send_action(session_id, actor, action, id)
                    .await?;
            }
            Err(error) => return Err(error.into()),
        }
        Ok(())
    }

    /// Compose a prompt in place. Compact and other actions are left as-is.
    ///
    /// Channel context is loaded when the prompt named an origin; a lookup
    /// failure still composes, with empty history, so a transient context
    /// outage cannot eat the prompt.
    pub(super) async fn compose_action(
        &self,
        action: &mut AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
        announce: Option<&AnnounceOrigin>,
    ) -> Result<()> {
        let AgentAction::Prompt(prompt) = action else {
            return Ok(());
        };
        let raw_prompt = prompt.prompt.clone();
        let prior_messages = if let Some(origin) = announce {
            Some(
                self.load_prompt_context(origin.channel_id, origin.message_id, actor)
                    .await,
            )
        } else {
            None
        };
        prompt.prompt = self
            .prompt_composer
            .compose(&raw_prompt, prior_messages.as_deref())
            .await?;
        prompt.set_name_source(raw_prompt);
        Ok(())
    }

    pub(super) async fn load_prompt_context(
        &self,
        channel_id: macro_uuid::Uuid,
        message_id: macro_uuid::Uuid,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> Vec<crate::domain::model::PriorChannelMessage> {
        async {
            if let Some(actor) = actor {
                self.prompt_context
                    .authorize_member(actor, channel_id)
                    .await?;
            }
            self.prompt_context
                .preceding_messages(channel_id, message_id)
                .await
        }
        .await
        .inspect_err(|error| {
            // Trigger events are admitted at-most-once. Context is useful,
            // but a transient lookup failure must not discard the prompt.
            tracing::warn!(
                error = ?error,
                %channel_id,
                %message_id,
                "sending agent prompt without channel history"
            );
        })
        .unwrap_or_default()
    }

    /// Who, if anyone, should be told that this landed.
    ///
    /// Only prompts are announced, and only when the caller named an origin
    /// to answer back into. A session has no channel of its own, so an origin
    /// is never redundant.
    pub(super) async fn announcement(
        &self,
        session_id: AgentSessionId,
        action: &AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
        announce: Option<AnnounceOrigin>,
    ) -> Result<Option<SessionAnnouncement>> {
        let (Some(origin), Some(triggered_by), AgentAction::Prompt(prompt)) =
            (announce, actor, action)
        else {
            return Ok(None);
        };

        // The announcement posts as the session's own bot, which only the
        // row remembers.
        let session = self.sessions.get_session(session_id).await?;

        Ok(Some(SessionAnnouncement {
            session_id,
            bot_id: session.bot_id,
            origin_channel_id: origin.channel_id,
            origin_thread_id: origin.thread_id,
            origin_message_id: origin.message_id,
            prompted_message_id: self.sessions.next_prompt_message_id(session_id).await?,
            prompted_content: prompt.prompt.clone(),
            triggered_by: triggered_by.clone(),
        }))
    }
}
