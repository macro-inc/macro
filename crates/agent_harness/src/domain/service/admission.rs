//! Quota admission at ingress and dispatch, and rejection of waiting commands.
//! Session owners fund managed inference; the actor can be a collaborator.

use super::*;
use agent_session::domain::events::{AgentSessionLifecycleEvent, CommandRejectedMetadata};
use ai_billing::AiAdmissionError;
use ai_usage::AiFeature;

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
    /// Origin-bearing commands must be authorized even when they will only
    /// queue (or arrived over the internal forwarding bus). Direct controls
    /// carry the access check performed when constructing `ControlEvent`.
    pub(super) async fn authorize_action(&self, command: &DeliverAction) -> Result<()> {
        if let Some(origin) = &command.announce {
            let actor = command.actor.as_ref().ok_or(AgentSessionError::Forbidden)?;
            self.prompt_context.authorize_origin(actor, origin).await?;
        }
        Ok(())
    }

    pub(super) async fn admit_session(&self, session: &AgentSession) -> Result<()> {
        let kind = AgentKind::for_session(session.bot_id, &session.harness);
        // Never use the actor or a system fallback for a missing user owner.
        self.admit_kind(kind, session.owner_user()?).await
    }

    /// Admit macro-funded work for `owner`. An in-memory session also passes
    /// when the allowance is spent but the owner's team has its own key: the
    /// runtime then decides each turn whether to run on it or to ask first.
    async fn admit_kind(&self, kind: AgentKind, owner: &MacroUserIdStr<'_>) -> Result<()> {
        if !macro_funded(kind) {
            return Ok(());
        }
        let denial = match self.admission.admit(owner, AiFeature::AgentSession).await {
            Ok(()) => return Ok(()),
            Err(denial @ AiAdmissionError::Denied(_)) => denial,
            Err(error) => return Err(error.into()),
        };
        if kind == AgentKind::InMemory {
            match self.team_keys.usable_providers(owner).await {
                Ok(providers) if !providers.is_empty() => return Ok(()),
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(error = ?error, "could not read the team's provider keys");
                }
            }
        }
        Err(denial.into())
    }

    pub(super) async fn admit_session_id(&self, session_id: AgentSessionId) -> Result<()> {
        self.admit_session(&self.sessions.get_session(session_id).await?)
            .await
    }

    /// Check waiting work without consuming it. Unavailability leaves it for
    /// the next ordinary queue-driving event, not an immediate retry loop.
    pub(super) async fn revalidate_queue(&self, session_id: AgentSessionId) -> Result<()> {
        if let Err(error) = self.admit_session_id(session_id).await {
            self.reject_waiting_on_denial(session_id, &error).await?;
            return Err(error);
        }
        Ok(())
    }

    pub(super) async fn reject_waiting_on_denial(
        &self,
        session_id: AgentSessionId,
        error: &HarnessError,
    ) -> Result<()> {
        // A steering follow-up may fail while the previous turn still runs.
        // Only release a provisional busy mark, never that running turn.
        if self.busy.turn(session_id).is_none() {
            self.busy.clear(session_id);
        }
        let HarnessError::Admission(failure @ AiAdmissionError::Denied(_)) = error else {
            return Ok(());
        };
        let waiting = self.queues.snapshot(session_id);
        if waiting.is_empty() {
            return Ok(());
        }
        self.queues.drop_session(session_id);
        if let Err(error) = self.persist_or_rollback(session_id).await {
            // Keep even newly announced entries if rollback itself cannot read
            // the store. The next event must revalidate, not forget this work.
            self.queues.replace(session_id, waiting);
            return Err(error);
        }
        self.publish_queue(session_id).await;
        // Persist first: never report a terminal rejection while the durable
        // queue still says that the command will run after a restart.
        for entry in waiting {
            let conversation_store = self.conversation_turns.as_ref().filter(|_| {
                entry.announce.as_ref().is_some_and(|origin| {
                    origin.reply_placement == crate::domain::model::ReplyPlacement::Timeline
                })
            });
            if let Some(store) = conversation_store {
                store
                    .finish(
                        entry.action_id,
                        crate::domain::conversation_turns::ConversationTurnState::Failed,
                        ReplyOutcome::Failed,
                    )
                    .await?;
            }
            let resolved = self
                .resolve_announced_reply(
                    session_id,
                    entry.announced,
                    entry.announce.as_ref(),
                    entry.actor.as_ref(),
                    ReplyOutcome::Failed,
                    // A refused entry never opened a turn: there is nothing
                    // it said or did to show, only that it was refused.
                    agent_fold::domain::model::TurnId(0),
                    Vec::new(),
                )
                .await;
            if resolved && let Some(store) = conversation_store {
                store
                    .finalize_reply(entry.action_id, &ReplyOutcome::Failed)
                    .await?;
            }
            self.publish_command_rejected(
                session_id,
                entry.action_id,
                entry.actor,
                entry.announced,
                *failure,
            )
            .await;
        }
        Ok(())
    }

    pub(super) async fn publish_command_rejected(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
        actor: Option<MacroUserIdStr<'static>>,
        announcement_message_id: Option<macro_uuid::Uuid>,
        failure: AiAdmissionError,
    ) {
        self.publish_lifecycle(session_id, |identity| {
            AgentSessionLifecycleEvent::CommandRejected(CommandRejectedMetadata {
                identity,
                action_id,
                actor,
                announcement_message_id,
                failure: failure.into(),
            })
        })
        .await;
    }

    pub(super) async fn admit_open(
        &self,
        bot: BotId,
        harness: &str,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<()> {
        self.admit_kind(AgentKind::for_session(bot, harness), owner)
            .await
    }
}

fn macro_funded(kind: AgentKind) -> bool {
    match kind {
        AgentKind::InMemory | AgentKind::SandboxedCoder => true,
        // Independently billed tools/helpers have their own admission; runtime
        // execution itself uses the owner's subscription or external provider.
        AgentKind::Cursor
        | AgentKind::CodexCloud
        | AgentKind::ClaudeCloud
        | AgentKind::External => false,
    }
}
