//! Reconcile an external turn with the reply independently announced by its trigger.

use super::*;
use crate::domain::external_replies::{
    ExternalReplyCompletion, ExternalReplyStore, ExternalReplyTarget,
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
>
    AgentHarnessService<
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
    /// Enable durable external replies before sharing this service.
    #[must_use]
    pub fn with_external_replies(mut self, store: Arc<dyn ExternalReplyStore>) -> Self {
        Arc::get_mut(&mut self.inner)
            .expect("configure external replies before cloning the harness")
            .external_replies = Some(store);
        self
    }

    /// Retry channel updates only; recovery never prompts the runtime again.
    #[tracing::instrument(skip_all, fields(external_reply.pending = tracing::field::Empty), err)]
    pub async fn recover_external_replies(&self) -> Result<()> {
        let Some(store) = &self.inner.external_replies else {
            return Ok(());
        };
        let pending = store.pending(100).await?;
        tracing::Span::current().record("external_reply.pending", pending.len());
        for reply in pending {
            if let Err(error) = self
                .inner
                .reconcile_external_reply(reply.session_id, reply.action_id)
                .await
            {
                tracing::warn!(?error, session_id = %reply.session_id, action_id = %reply.action_id, "external reply reconciliation failed; will retry");
            }
        }
        Ok(())
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
    /// Reserve the reply before posting. Both sides use the source message's ID.
    #[tracing::instrument(skip(self, origin, actor), fields(%session_id, message_id = %origin.message_id), err)]
    pub(super) async fn announce_external_reply(
        &self,
        session_id: AgentSessionId,
        origin: AnnounceOrigin,
        actor: MacroUserIdStr<'static>,
    ) -> Result<()> {
        let Some(store) = &self.external_replies else {
            return Ok(());
        };
        self.prompt_context
            .authorize_origin(&actor, &origin)
            .await?;
        let action_id = AgentActionId::from_uuid(origin.message_id);
        store
            .reserve(
                session_id,
                action_id,
                &ExternalReplyTarget {
                    origin,
                    actor,
                    message_id: macro_uuid::generate_uuid_v7(),
                },
            )
            .await?;
        if let Err(error) = self.reconcile_external_reply(session_id, action_id).await {
            tracing::warn!(?error, %session_id, %action_id, "external reply reserved; posting will retry");
        }
        Ok(())
    }

    /// Keep the terminal result before touching the channel, including when
    /// the observed trigger has not reached this replica yet.
    #[tracing::instrument(skip_all, fields(%session_id, %action_id, ?turn))]
    pub(super) async fn complete_external_reply(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
        turn: agent_fold::domain::model::TurnId,
        outcome: ReplyOutcome,
    ) {
        let Some(store) = &self.external_replies else {
            return;
        };
        let result = async {
            let session = self.sessions.get_session(session_id).await?;
            if AgentKind::for_session(session.bot_id, &session.harness) != AgentKind::External {
                return Ok::<_, HarnessError>(());
            }
            store
                .complete(
                    session_id,
                    action_id,
                    &ExternalReplyCompletion { turn, outcome },
                )
                .await?;
            self.reconcile_external_reply(session_id, action_id).await
        }
        .await;
        if let Err(error) = result {
            tracing::error!(?error, %session_id, %action_id, "could not reconcile an external turn's reply");
        }
    }

    #[tracing::instrument(skip(self), fields(%session_id, %action_id, external_reply.claimed = false), err)]
    async fn reconcile_external_reply(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
    ) -> Result<()> {
        let Some(store) = &self.external_replies else {
            return Ok(());
        };
        let Some(_lease) = store.claim(session_id, action_id).await? else {
            return Ok(());
        };
        tracing::Span::current().record("external_reply.claimed", true);
        let Some(mut reply) = store.get(session_id, action_id).await? else {
            return Ok(());
        };
        if reply.finalized {
            return Ok(());
        }
        let Some(target) = reply.target else {
            return Ok(());
        };
        if let Err(error) = self
            .prompt_context
            .authorize_origin(&target.actor, &target.origin)
            .await
        {
            if matches!(error, HarnessError::InvalidOrigin(_)) {
                store.finalize(session_id, action_id).await?;
            }
            return Err(error);
        }
        if reply.completion.is_none() {
            use agent_session::domain::action_history::RecordedAction;
            let completion = match self.sessions.recorded_action(session_id, action_id).await? {
                Some(RecordedAction::Finished {
                    turn,
                    stop,
                    last_text,
                    ..
                }) => Some(ExternalReplyCompletion {
                    turn,
                    outcome: ReplyOutcome::of_turn(&stop, last_text),
                }),
                Some(RecordedAction::Interrupted { turn }) => Some(ExternalReplyCompletion {
                    turn,
                    outcome: ReplyOutcome::Failed,
                }),
                Some(RecordedAction::Running { .. }) | None => None,
            };
            if let Some(completion) = completion {
                store.complete(session_id, action_id, &completion).await?;
                reply.completion = Some(completion);
            }
        }
        let session = self.sessions.get_session(session_id).await?;
        // Posting a reserved ID is idempotent and never overwrites a completed
        // or deleted message. A lost post response can therefore be retried.
        if !reply.announced {
            self.announcer
                .announce(SessionAnnouncement {
                    reply_message_id: Some(target.message_id),
                    reply_placement: target.origin.reply_placement,
                    reuse_origin_message: false,
                    session_id,
                    bot_id: session.bot_id,
                    is_coding: false,
                    origin_parent: target.origin.parent.clone(),
                    origin_thread_id: target.origin.thread_id,
                    origin_message_id: target.origin.message_id,
                    prompted_message_id: MessageId::first(AuthorKind::User),
                    prompted_content: String::new(),
                    triggered_by: target.actor.clone(),
                })
                .await?;
            store.mark_announced(session_id, action_id).await?;
        }
        if let Some(completion) = reply.completion {
            self.announcer
                .resolve(ResolvedReply {
                    session_id,
                    bot_id: session.bot_id,
                    is_coding: false,
                    message_id: target.message_id,
                    origin_parent: target.origin.parent,
                    triggered_by: target.actor,
                    outcome: completion.outcome,
                    turn: completion.turn,
                    segments: Vec::new(),
                })
                .await?;
            store.finalize(session_id, action_id).await?;
        }
        Ok(())
    }
}
