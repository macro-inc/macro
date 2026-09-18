//! Delivering one queued action to the running agent: announce it in the
//! channel, compose it with channel context, and prompt the runtime.

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
                        .attach_session(session_id, container.mcp_servers(mcp_servers))
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
                    let egress = self
                        .egress
                        .provision(
                            session_id,
                            &session.owner_id,
                            &AgentMcpServers::Selected {
                                servers: Vec::new(),
                            },
                        )
                        .await?;
                    self.sessions
                        .set_egress_token_hash(session_id, &egress.session_token_hash)
                        .await?;
                    self.sessions
                        .attach_session(
                            session_id,
                            attachment.mcp_servers(vec![egress.sandbox.internal_mcp_server()]),
                        )
                        .await?;
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
    /// Message context is loaded when the prompt named an origin. The actor's
    /// current access to that origin gates composition; a failed history read
    /// still composes, with empty history, so a transient context outage
    /// cannot eat the prompt.
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
            Some(self.load_prompt_context(origin, actor).await?)
        } else {
            None
        };
        prompt.prompt = self
            .prompt_composer
            .compose(
                &raw_prompt,
                announce.map(|origin| &origin.parent),
                prior_messages.as_deref(),
            )
            .await?;
        prompt.set_name_source(raw_prompt);
        Ok(())
    }

    /// Recheck the actor's access to the origin, then read the history before
    /// it. Authorization is not optional: a prompt that names an origin was
    /// posted by a user, and one who may no longer write there sends nothing.
    pub(super) async fn load_prompt_context(
        &self,
        origin: &AnnounceOrigin,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> Result<Vec<crate::domain::model::PriorMessage>> {
        let actor = actor.ok_or_else(|| {
            HarnessError::PromptContext(rootcause::report!(
                "message prompts require an acting user"
            ))
        })?;
        self.prompt_context.authorize_origin(actor, origin).await?;
        Ok(self
            .prompt_context
            .preceding_messages(actor, origin)
            .await
            .inspect_err(|error| {
                // Trigger events are admitted at-most-once. Context is useful,
                // but a transient lookup failure must not discard the prompt.
                tracing::warn!(
                    error = ?error,
                    parent = ?origin.parent,
                    message_id = %origin.message_id,
                    "sending agent prompt without conversation history"
                );
            })
            .unwrap_or_default())
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
        prompted_message_id: MessageId,
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
            origin_parent: origin.parent,
            origin_thread_id: origin.thread_id,
            origin_message_id: origin.message_id,
            prompted_message_id,
            prompted_content: prompt.prompt.clone(),
            triggered_by: triggered_by.clone(),
        }))
    }
}
