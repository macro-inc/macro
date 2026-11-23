//! Quota and runtime-access admission at ingress and dispatch, and rejection
//! of waiting commands. Session owners fund managed inference; the actor can be
//! a collaborator.

use super::*;
use crate::domain::model::RuntimeAccessFacts;
use agent_session::domain::error::NO_RUNTIME_ACCESS_CODE;
use agent_session::domain::events::{
    AgentSessionLifecycleEvent, CommandFailure, CommandRejectedMetadata,
};
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

    /// A prompt reaches a registered runtime only while it may run there.
    /// Checked when it is accepted, and again when it dispatches: access
    /// removed while it waited must stop it too.
    pub(super) async fn authorize_runtime(
        &self,
        session_id: AgentSessionId,
        command: &DeliverAction,
    ) -> Result<()> {
        let Some(reason) = self
            .runtime_refusal(session_id, &command.action, command.actor.as_ref())
            .await?
        else {
            return Ok(());
        };
        self.refuse_prompt(
            session_id,
            command.id,
            command.announce.as_ref(),
            command.actor.clone(),
            &reason,
        )
        .await?;
        Err(AgentSessionError::NoRuntimeAccess(reason).into())
    }

    /// Why a prompt may not run on the session's registered runtime, or
    /// `None` when it may (or the session runs elsewhere).
    pub(super) async fn runtime_refusal(
        &self,
        session_id: AgentSessionId,
        action: &AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> Result<Option<String>> {
        if !matches!(action, AgentAction::Prompt(_)) {
            return Ok(None);
        }
        let session = self.sessions.get_session(session_id).await?;
        if AgentKind::for_session(session.bot_id, &session.harness) != AgentKind::External {
            return Ok(None);
        }
        let facts = self
            .runtimes
            .access_facts(session.bot_id, actor)
            .await
            .map_err(|error| HarnessError::RuntimeDirectory(rootcause::report!(error).into()))?;
        let Some(facts) = facts.filter(|facts| !facts.may_run()) else {
            return Ok(None);
        };
        tracing::warn!(
            agent.session.id = %session_id,
            bot_id = %session.bot_id,
            resident = facts.resident,
            "refused a turn: no access to the agent's runtime"
        );
        Ok(Some(runtime_refusal_reason(&facts)))
    }

    /// Settle a prompt refused for runtime access: its conversation turn
    /// fails, the conversation it came from is told why, and so are the
    /// session's viewers. Telling the conversation is best effort: the
    /// refusal stands either way.
    pub(super) async fn refuse_prompt(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
        origin: Option<&AnnounceOrigin>,
        actor: Option<MacroUserIdStr<'static>>,
        reason: &str,
    ) -> Result<()> {
        let conversation_store = self.conversation_turns.as_ref().filter(|_| {
            origin.is_some_and(|origin| {
                origin.reply_placement == crate::domain::model::ReplyPlacement::Timeline
            })
        });
        if let Some(store) = conversation_store {
            store.fail_queued(action_id).await?;
        }
        if let (Some(origin), Some(triggered_by)) = (origin, actor.clone())
            && !origin.reuse_origin_message
        {
            let session = self.sessions.get_session(session_id).await?;
            let presented = self
                .announcer
                .present(crate::domain::model::ReplyPresentation {
                    session_id,
                    bot_id: session.bot_id,
                    triggered_by,
                    parent: origin.parent.clone(),
                    thread_id: origin.reply_placement.thread_id(origin.thread_id),
                    message_id: refusal_message_id(session_id, action_id),
                    turn: agent_fold::domain::model::TurnId(0),
                    segments: Vec::new(),
                    link: false,
                    pending: false,
                    outcome: Some(ReplyOutcome::Refused(reason.to_owned())),
                    notify: true,
                })
                .await;
            if let Err(error) = presented {
                tracing::warn!(
                    ?error,
                    %session_id,
                    %action_id,
                    "could not say in the conversation why a prompt was refused"
                );
            }
        }
        if let Some(store) = conversation_store {
            store
                .finalize_reply(action_id, &ReplyOutcome::Failed)
                .await?;
        }
        self.publish_command_rejected(
            session_id,
            action_id,
            actor,
            None,
            CommandFailure {
                code: NO_RUNTIME_ACCESS_CODE.to_owned(),
                message: reason.to_owned(),
                retryable: false,
            },
        )
        .await;
        Ok(())
    }

    pub(super) async fn admit_session(&self, session: &AgentSession) -> Result<()> {
        let kind = AgentKind::for_session(session.bot_id, &session.harness);
        if !macro_funded(kind) || self.runs_on_agent_key(kind, session).await {
            return Ok(());
        }
        // Never use the actor or a system fallback for a missing user owner.
        self.admission
            .admit(session.owner_user()?, AiFeature::AgentSession)
            .await?;
        Ok(())
    }

    /// Whether an in-memory session's agent runs on its own usable key, so
    /// its turns never spend the owner's allowance. A failed lookup leaves the
    /// allowance gate in place.
    async fn runs_on_agent_key(&self, kind: AgentKind, session: &AgentSession) -> bool {
        if kind != AgentKind::InMemory {
            return false;
        }
        let Ok(owner) = session.owner_user() else {
            return false;
        };
        self.agent_keys
            .usable_provider(session.bot_id.as_uuid(), owner)
            .await
            .inspect_err(
                |error| tracing::error!(error = ?error, "could not read the agent's API key"),
            )
            .ok()
            .flatten()
            .is_some()
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
                (*failure).into(),
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
        failure: CommandFailure,
    ) {
        self.publish_lifecycle(session_id, |identity| {
            AgentSessionLifecycleEvent::CommandRejected(CommandRejectedMetadata {
                identity,
                action_id,
                actor,
                announcement_message_id,
                failure,
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
        if macro_funded(AgentKind::for_session(bot, harness)) {
            self.admission.admit(owner, AiFeature::AgentSession).await?;
        }
        Ok(())
    }
}

/// Seeds [`refusal_message_id`], so a redelivered refusal finds its message.
const REFUSAL_MESSAGE_NAMESPACE: macro_uuid::Uuid =
    macro_uuid::Uuid::from_u128(0x6c0f_3a5e_9d21_4b7e_8f30_2a41_c7d5_e913);

/// The message that tells a conversation why one prompt was refused.
fn refusal_message_id(session_id: AgentSessionId, action_id: AgentActionId) -> macro_uuid::Uuid {
    macro_uuid::Uuid::new_v5(
        &REFUSAL_MESSAGE_NAMESPACE,
        format!("{session_id}:{action_id}").as_bytes(),
    )
}

/// What the person prompting is told. A resident stops when its owner loses
/// access, whoever prompts it; a coding agent needs its prompter to have it.
fn runtime_refusal_reason(facts: &RuntimeAccessFacts) -> String {
    let runtime = &facts.runtime_name;
    if facts.resident || facts.actor_may_use.is_none() {
        format!("This agent has stopped: its owner no longer has access to {runtime}.")
    } else {
        format!(
            "You don't have access to {runtime}, where this agent runs. Ask its owner for access."
        )
    }
}

fn macro_funded(kind: AgentKind) -> bool {
    match kind {
        AgentKind::InMemory | AgentKind::SandboxedCoder => true,
        // Independently billed tools/helpers have their own admission; runtime
        // execution itself uses the owner's subscription or external provider.
        AgentKind::Cursor | AgentKind::CodexCloud | AgentKind::External => false,
    }
}
