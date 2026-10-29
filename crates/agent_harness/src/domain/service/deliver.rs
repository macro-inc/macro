//! Delivering one queued action to the running agent: announce it in the
//! channel, compose it with channel context, and prompt the runtime.

use super::*;

enum NotificationRecovery {
    Pending,
    Running,
    Completed,
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
    /// Restore the runtime transport without starting a new invocation.
    async fn reconnect(&self, session_id: AgentSessionId) -> Result<AgentSession> {
        let session = self.sessions.get_session(session_id).await?;
        let permission_policy = self
            .permission_policy_for_session(session_id, session.bot_id)
            .await?;
        let kind = AgentKind::for_session(session.bot_id, &session.harness);
        if kind.is_managed() {
            let container = self.containers.resume(session_id).await?;
            let mcp_servers = self
                .resumed_mcp_servers(
                    session_id,
                    kind,
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
            let Some(mut attachment) = self.runtimes.bind(session.bot_id, session_id).await else {
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
                .provision(session_id, session.owner_user()?, &session.mcp_servers)
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
        Ok(session)
    }

    /// Reconcile a prior invocation before deciding whether a batch may run.
    async fn recover_batch(
        &self,
        session_id: AgentSessionId,
        batch: &agent_session::domain::notifications::NotificationBatch,
    ) -> Result<NotificationRecovery> {
        use agent_session::domain::{
            action_history::RecordedAction, notifications::NotificationOutcome,
        };
        let Some(store) = &self.notification_store else {
            return Ok(NotificationRecovery::Pending);
        };
        match self
            .sessions
            .recorded_action(session_id, batch.action_id)
            .await?
        {
            Some(RecordedAction::Finished {
                notification_noop, ..
            }) => {
                store
                    .complete(
                        batch.lease_id,
                        if notification_noop {
                            NotificationOutcome::Noop
                        } else {
                            NotificationOutcome::Delivered
                        },
                    )
                    .await?;
                Ok(NotificationRecovery::Completed)
            }
            Some(RecordedAction::Running { turn, .. }) => {
                let session = self.sessions.get_session(session_id).await?;
                // Claims demote matching legacy background actions. Neither
                // their old wire actor nor a newer turn can supply authority.
                let actor = self
                    .sessions
                    .turn_prompter(session_id)
                    .await?
                    .filter(|prompter| prompter.action_id == batch.action_id)
                    .and_then(|prompter| prompter.acting_user().cloned());
                // Do not rewrite turn_prompter: a batch attached to a real
                // prompt retains that user's authority across recovery.
                self.notification_batches.insert(session_id, batch.clone());
                self.busy.mark_turn(
                    session_id,
                    InFlightTurn {
                        action_id: batch.action_id,
                        turn,
                        actor,
                        announce: None,
                        announcement_message_id: None,
                        dispatched_at: chrono::Utc::now(),
                        bot_id: Some(session.bot_id),
                        speaks_as_chip: false,
                        presented: Vec::new(),
                        held_tool_calls: Vec::new(),
                    },
                );
                if !matches!(
                    self.sessions.management(session_id).await?,
                    SessionManagement::Ours
                ) && let Err(error) = self.reconnect(session_id).await
                {
                    self.notification_batches.remove(&session_id);
                    self.busy.clear(session_id);
                    store.release(batch.lease_id).await?;
                    return Err(error);
                }
                // Periodic serialized reconciliation checks this installed
                // batch too, including responses committed during attachment.
                Ok(NotificationRecovery::Running)
            }
            Some(RecordedAction::Interrupted { .. }) | None => {
                if batch.notifications.is_empty() {
                    return Err(AgentSessionError::from(
                        rootcause::report!("notification payload requires a compatible consumer")
                            .into_dynamic(),
                    )
                    .into());
                }
                Ok(NotificationRecovery::Pending)
            }
        }
    }

    /// Stage a waking batch, recovering completed attempts without invoking
    /// the model again when a process died between its response and the ack.
    #[tracing::instrument(name = "agent.notification.deliver", skip_all, fields(%session_id), err)]
    pub(super) async fn stage_notifications(&self, session_id: AgentSessionId) -> Result<()> {
        let Some(store) = &self.notification_store else {
            return Ok(());
        };
        for _ in 0..100 {
            let Some(batch) = store.claim(session_id, false).await? else {
                return Ok(());
            };
            match self.recover_batch(session_id, &batch).await? {
                NotificationRecovery::Completed => continue,
                NotificationRecovery::Running => return Ok(()),
                NotificationRecovery::Pending => {}
            }
            if !batch.wake {
                store.defer_until_prompt(batch.lease_id).await?;
                continue;
            }
            for context in &batch.producer_contexts {
                genai_telemetry::propagation::link(&tracing::Span::current(), Some(context));
            }
            let entry = QueuedEntry {
                action_id: batch.action_id,
                action: AgentAction::notification(batch.notifications.clone()),
                actor: None,
                announce: None,
                context: None,
                announced: None,
                created_at: chrono::Utc::now(),
            };
            self.notification_batches.insert(session_id, batch);
            self.queues.requeue_front(session_id, entry);
            break;
        }
        Ok(())
    }

    /// Attach quiet events, or recover the prior turn before dispatching this
    /// prompt. False means the caller must leave its real prompt queued.
    #[tracing::instrument(name = "agent.notification.deliver", skip_all, fields(%session_id, %action_id), err)]
    pub(super) async fn attach_notifications(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
        action: &mut AgentAction,
    ) -> Result<bool> {
        if self.notification_batches.contains_key(&session_id) {
            return Ok(true);
        }
        let AgentAction::Prompt(prompt) = action else {
            return Ok(true);
        };
        let Some(store) = &self.notification_store else {
            return Ok(true);
        };
        for _ in 0..100 {
            let Some(mut batch) = store.claim(session_id, true).await? else {
                return Ok(true);
            };
            match self.recover_batch(session_id, &batch).await? {
                NotificationRecovery::Completed => continue,
                NotificationRecovery::Running => return Ok(false),
                NotificationRecovery::Pending => {}
            }
            store.bind_action(batch.lease_id, action_id).await?;
            batch.action_id = action_id;
            for context in &batch.producer_contexts {
                genai_telemetry::propagation::link(&tracing::Span::current(), Some(context));
            }
            prompt.notifications = Some(
                agent_runtime_protocol::domain::notification::NotificationInput {
                    notifications: batch.notifications.clone(),
                    system_turn: false,
                },
            );
            self.notification_batches.insert(session_id, batch);
            return Ok(true);
        }
        Ok(true)
    }

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
            context: _,
        } = command;

        if !matches!(action, AgentAction::Stop)
            && let Some(policy) = &self.conversations
        {
            let session = self.sessions.get_session(session_id).await?;
            policy
                .authorize_prompt(session_id, session.bot_id, if matches!(&action, AgentAction::Prompt(prompt) if prompt.notifications.as_ref().is_some_and(|input| input.system_turn)) { session.owner_id.as_user() } else { actor.as_ref() })
                .await?;
        }
        if action.occupies_turn() {
            self.admit_session_id(session_id).await?;
            self.refresh_mcp_servers(session_id).await;
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
                let session = self.reconnect(session_id).await?;
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
    /// A prompt that names an origin is only composed while the actor may
    /// still write there. Why the agent was called arrives with the prompt,
    /// read by whatever triggered it; nothing here reads the conversation. The
    /// prompt that opens a session's first turn also carries the session's
    /// instructions, unless its runtime already reads them as a system prompt.
    pub(super) async fn compose_action(
        &self,
        session_id: AgentSessionId,
        action: &mut AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
        announce: Option<&AnnounceOrigin>,
        context: Option<&TriggerContext>,
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
        let instructions = instructions.into_iter().collect::<Vec<_>>().join("\n\n");
        if let Some(origin) = announce {
            self.authorize_prompt_origin(origin, actor).await?;
        }
        prompt.prompt = self
            .prompt_composer
            .compose(
                &raw_prompt,
                (!instructions.is_empty()).then_some(instructions.as_str()),
                people.as_ref(),
                context,
            )
            .await?;
        prompt.set_name_source(raw_prompt);
        Ok(())
    }

    /// Recheck the actor's access to the origin. Authorization is not
    /// optional: a prompt that names an origin was posted by a user, and one
    /// who may no longer write there sends nothing.
    pub(super) async fn authorize_prompt_origin(
        &self,
        origin: &AnnounceOrigin,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> Result<()> {
        let actor = actor.ok_or_else(|| {
            HarnessError::PromptContext(rootcause::report!(
                "message prompts require an acting user"
            ))
        })?;
        self.prompt_context.authorize_origin(actor, origin).await
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
        let is_coding = if origin.reply_placement == crate::domain::model::ReplyPlacement::Thread {
            self.reply_persona(&session).await?.is_coding
        } else {
            false
        };

        Ok(Some(SessionAnnouncement {
            reply_message_id: None,
            reply_placement: origin.reply_placement,
            reuse_origin_message: origin.reuse_origin_message,
            session_id,
            bot_id: session.bot_id,
            is_coding,
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
        mut outcome: ReplyOutcome,
    ) {
        let Some(turn) = turn else {
            return;
        };
        let terminal = !matches!(
            outcome,
            ReplyOutcome::NeedsInput { .. }
                | ReplyOutcome::AwaitingApproval(_)
                | ReplyOutcome::Resumed
        );
        if terminal && turn.announce.is_none() {
            self.complete_external_reply(session_id, turn.action_id, turn.turn, outcome.clone())
                .await;
        }
        let in_segments = turn.announce.as_ref().is_some_and(|origin| {
            origin.reply_placement.voice_style() == crate::domain::model::VoiceStyle::Segments
        });
        // A reply shown in segments is shown once its turn has ended. While
        // the turn waits on a question or an approval, it is answered live
        // and the bot's typing says it is waiting.
        if in_segments && !terminal {
            return;
        }
        let conversation_store = self.conversation_turns.as_ref().filter(|_| {
            turn.announce.as_ref().is_some_and(|origin| {
                origin.reply_placement == crate::domain::model::ReplyPlacement::Timeline
            })
        });
        let _reply_lease = if terminal && let Some(store) = conversation_store {
            match store.claim_reply(turn.action_id).await {
                Ok(Some(lease)) => Some(lease),
                Ok(None) => return,
                Err(error) => {
                    tracing::error!(?error, %session_id, "could not claim conversation reply reconciliation");
                    return;
                }
            }
        } else {
            None
        };
        let mut turn = turn.clone();
        let mut saved_reply = Vec::new();
        if terminal && let Some(store) = conversation_store {
            match store.by_action(turn.action_id).await {
                Ok(Some(record)) if record.reply_finalized => return,
                Ok(Some(record)) => {
                    // Another replica may have reserved more reply IDs since
                    // the caller read this turn. Always use the durable flight
                    // read under the reply lease, including after a failed post.
                    let Some(saved_flight) = record.in_flight else {
                        return;
                    };
                    turn = saved_flight;
                    if let Some(saved) = record.outcome {
                        outcome = saved;
                    }
                    saved_reply = record.reply_segments.unwrap_or_default();
                }
                Err(error) => {
                    tracing::error!(?error, %session_id, "could not read the durable conversation reply state");
                    return;
                }
                Ok(None) => return,
            }
        }
        let resolved = if in_segments {
            self.present_final(session_id, &turn, outcome.clone(), saved_reply)
                .await
        } else {
            let segments = if turn.speaks_as_chip {
                Vec::new()
            } else {
                crate::domain::presenter::turn_segments(
                    &self.reported_segments(session_id, turn.turn),
                )
            };
            self.resolve_announced_reply(
                session_id,
                turn.announcement_message_id,
                turn.announce.as_ref(),
                turn.actor.as_ref(),
                outcome.clone(),
                turn.turn,
                segments,
            )
            .await
        };
        if resolved
            && terminal
            && let Some(store) = conversation_store
            && let Err(error) = store.finalize_reply(turn.action_id, &outcome).await
        {
            tracing::error!(?error, %session_id, "failed to mark the conversation reply finalized");
        }
    }

    /// Resolve an announcement even when its queued command never opened a turn.
    #[expect(
        clippy::too_many_arguments,
        reason = "each argument is a separate fact about the reply; bundling them only moves the list"
    )]
    pub(super) async fn resolve_announced_reply(
        &self,
        session_id: AgentSessionId,
        message_id: Option<macro_uuid::Uuid>,
        origin: Option<&AnnounceOrigin>,
        actor: Option<&MacroUserIdStr<'static>>,
        outcome: ReplyOutcome,
        turn: agent_fold::domain::model::TurnId,
        segments: Vec<agent_fold::domain::model::ProjectedSegment>,
    ) -> bool {
        let (Some(message_id), Some(origin), Some(triggered_by)) = (message_id, origin, actor)
        else {
            return true;
        };
        // An assignment announces a session link, not a discussion reply.
        // Later user messages have their own origins and can still be answered.
        if origin.reuse_origin_message {
            return true;
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
                return false;
            }
        };
        // A timeline reply remains resolvable if its persona was deleted
        // during the turn. The session preserves its author identity.
        let is_coding = if origin.reply_placement == crate::domain::model::ReplyPlacement::Timeline
        {
            false
        } else {
            match self.reply_persona(&session).await {
                Ok(persona) => persona.is_coding,
                Err(error) => {
                    tracing::error!(
                        error = ?error,
                        %session_id,
                        %message_id,
                        "leaving a turn's reply unresolved: the session's persona is unavailable"
                    );
                    return false;
                }
            }
        };
        if let Err(error) = self
            .announcer
            .resolve(ResolvedReply {
                session_id,
                bot_id: session.bot_id,
                is_coding,
                message_id,
                origin_parent: origin.parent.clone(),
                triggered_by: triggered_by.clone(),
                outcome: outcome.clone(),
                turn,
                segments,
            })
            .await
        {
            tracing::error!(
                error = ?error,
                %session_id,
                %message_id,
                "failed to resolve a turn's reply in its thread"
            );
            false
        } else {
            true
        }
    }
}
