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

        if action.occupies_turn() {
            self.admit_session_id(session_id).await?;
        }

        match self
            .sessions
            .send_action(session_id, actor.clone(), action.clone(), id)
            .await
        {
            Ok(()) => {}
            // Nothing is attached, so get this session onto a transport and
            // retry against it. Same id: the first attempt never reached the
            // wire.
            Err(error @ AgentSessionError::Disconnected(_))
                if matches!(action, AgentAction::RespondToPermission(_)) =>
            {
                return Err(error.into());
            }
            Err(AgentSessionError::Disconnected(_)) => {
                let session = self.sessions.get_session(session_id).await?;
                let permission_policy = self.permission_policy_for(session.bot_id).await;
                if AgentKind::for_session(session.bot_id, &session.harness).is_managed() {
                    let container = self.containers.resume(session_id).await?;
                    let mcp_servers = self
                        .resumed_mcp_servers(
                            session_id,
                            session.owner_user()?,
                            &session.mcp_servers,
                        )
                        .await?;
                    self.sessions
                        .attach_session(
                            session_id,
                            container
                                .mcp_servers(mcp_servers)
                                .permission_policy(permission_policy),
                        )
                        .await?;
                    // The sandbox is back; take waiting prompts from the store
                    // so a restart cannot drop what was queued while this
                    // replica was gone.
                    self.restore_queue(session_id).await?;
                } else {
                    // An external runtime is not ours to start - only its
                    // operator can dial - but a bot whose runtime is already
                    // connected just has not had this session bound to it
                    // yet. That is the ordinary case: sessions bind when they
                    // are prompted, not when the runtime dials, so the first
                    // prompt after a reconnect is what restores the session.
                    let Some(mut attachment) = self.runtimes.bind(session.bot_id, session_id).await
                    else {
                        // Kept in the session vocabulary so transports report
                        // it as a disconnect, not an internal error.
                        return Err(HarnessError::Session(AgentSessionError::Disconnected(
                            session_id,
                        )));
                    };
                    if session.harness == harness_id::MACROD_HARNESS_SLUG {
                        attachment = attachment.initial_model(session.model.clone());
                    }
                    let egress = self
                        .egress
                        .provision(
                            session_id,
                            session.owner_user()?,
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
                            attachment
                                .permission_policy(permission_policy)
                                .mcp_servers(self.egress.external_mcp_servers(&egress.sandbox)),
                        )
                        .await?;
                    self.restore_queue(session_id).await?;
                }
                if action.occupies_turn() {
                    self.admit_session(&session).await?;
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
    /// cannot eat the prompt. The prompt that opens a session's first turn
    /// also carries the session's instructions, unless its runtime already
    /// reads them as a system prompt.
    pub(super) async fn compose_action(
        &self,
        session_id: AgentSessionId,
        action: &mut AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
        announce: Option<&AnnounceOrigin>,
        first_turn: bool,
    ) -> Result<()> {
        let AgentAction::Prompt(prompt) = action else {
            return Ok(());
        };
        let session = self.sessions.get_session(session_id).await?;
        // Every prompt names the owner and its sender, so the agent can tell
        // a request from the person whose access it spends from anyone
        // else's. A session owned by a bot or team has no person to name.
        let people = session.owner_id.as_user().map(|owner| PromptPeople {
            owner: owner.clone(),
            sender: actor.cloned(),
        });
        let raw_prompt = prompt.prompt.clone();
        let instructions = Some(&session)
            .filter(|session| {
                first_turn
                    && AgentKind::for_session(session.bot_id, &session.harness).folds_instructions()
            })
            .and_then(|session| session.instructions.as_deref())
            .filter(|instructions| !instructions.trim().is_empty());
        let context = if let Some(origin) = announce {
            Some(self.load_prompt_context(origin, actor).await?)
        } else {
            None
        };
        prompt.prompt = self
            .prompt_composer
            .compose(
                &raw_prompt,
                instructions,
                announce
                    .filter(|origin| !origin.reuse_origin_message)
                    .map(|origin| &origin.parent),
                people.as_ref(),
                context.as_ref(),
            )
            .await?;
        prompt.set_name_source(raw_prompt);
        Ok(())
    }

    /// Recheck the actor's access to the origin, then read the conversation
    /// around it. Authorization is not optional: a prompt that names an origin
    /// was posted by a user, and one who may no longer write there sends nothing.
    pub(super) async fn load_prompt_context(
        &self,
        origin: &AnnounceOrigin,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> Result<crate::domain::model::ConversationContext> {
        let actor = actor.ok_or_else(|| {
            HarnessError::PromptContext(rootcause::report!(
                "message prompts require an acting user"
            ))
        })?;
        self.prompt_context.authorize_origin(actor, origin).await?;
        // Assignment context is supplied privately. It was not a user message
        // in the discussion, so do not add history or thread-reply instructions.
        if origin.reuse_origin_message {
            return Ok(Default::default());
        }
        Ok(self
            .prompt_context
            .conversation_context(actor, origin)
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
        let persona = self.reply_persona(&session).await?;

        Ok(Some(SessionAnnouncement {
            reuse_origin_message: origin.reuse_origin_message,
            session_id,
            bot_id: session.bot_id,
            is_coding: persona.is_coding,
            origin_parent: origin.parent,
            origin_thread_id: origin.thread_id,
            origin_message_id: origin.message_id,
            prompted_message_id,
            prompted_content: prompt.prompt.clone(),
            triggered_by: triggered_by.clone(),
        }))
    }

    /// Tell the thread what an announced turn's reply should say now: how
    /// the turn ended, or that it is waiting on the user.
    ///
    /// Best-effort, like every lifecycle publish: the turn is over or still
    /// running regardless, and the queue behind it drains whether or not the
    /// thread hears. The bot and its persona are re-read as they were when
    /// the turn was announced. A turn nobody announced - no origin, no
    /// actor, or no message posted - has nothing to resolve. Whether the
    /// persona's message needs resolving at all is the announcer's call.
    pub(super) async fn resolve_reply(
        &self,
        session_id: AgentSessionId,
        turn: Option<&InFlightTurn>,
        outcome: ReplyOutcome,
    ) {
        let Some(turn) = turn else {
            return;
        };
        self.resolve_announced_reply(
            session_id,
            turn.announcement_message_id,
            turn.announce.as_ref(),
            turn.actor.as_ref(),
            outcome,
        )
        .await;
    }

    /// Resolve an announcement even when its queued command never opened a turn.
    pub(super) async fn resolve_announced_reply(
        &self,
        session_id: AgentSessionId,
        message_id: Option<macro_uuid::Uuid>,
        origin: Option<&AnnounceOrigin>,
        actor: Option<&MacroUserIdStr<'static>>,
        outcome: ReplyOutcome,
    ) {
        let (Some(message_id), Some(origin), Some(triggered_by)) = (message_id, origin, actor)
        else {
            return;
        };
        // An assignment announces a session link, not a discussion reply.
        // Later user messages have their own origins and can still be answered.
        if origin.reuse_origin_message {
            return;
        }
        let session = match self.sessions.get_session(session_id).await {
            Ok(session) => session,
            Err(error) => {
                tracing::error!(
                    error = ?error,
                    %session_id,
                    %message_id,
                    "leaving a turn's reply unresolved: session row unavailable"
                );
                return;
            }
        };
        let persona = match self.reply_persona(&session).await {
            Ok(persona) => persona,
            Err(error) => {
                tracing::error!(
                    error = ?error,
                    %session_id,
                    %message_id,
                    "leaving a turn's reply unresolved: the session's persona is unavailable"
                );
                return;
            }
        };
        if let Err(error) = self
            .announcer
            .resolve(ResolvedReply {
                session_id,
                bot_id: session.bot_id,
                is_coding: persona.is_coding,
                message_id,
                origin_parent: origin.parent.clone(),
                triggered_by: triggered_by.clone(),
                outcome,
            })
            .await
        {
            tracing::error!(
                error = ?error,
                %session_id,
                %message_id,
                "failed to resolve a turn's reply in its thread"
            );
        }
    }
}
