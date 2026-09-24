//! Admission at ingress and again when queued Macro-funded work starts.

use agent_session::domain::events::{AgentSessionLifecycleEvent, CommandRejectedMetadata};
use ai_billing::domain::{AiAdmissionError, DenyReason};
use ai_usage::domain::AiFeature;

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
    pub(super) async fn admit_owner(
        &self,
        kind: AgentKind,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<()> {
        if matches!(kind, AgentKind::InMemory | AgentKind::SandboxedCoder) {
            self.admission.admit(owner, AiFeature::AgentSession).await?;
        }
        Ok(())
    }

    pub(super) async fn admit_session(&self, session_id: AgentSessionId) -> Result<()> {
        let session = self.sessions.get_session(session_id).await?;
        let kind = AgentKind::for_session(session.bot_id, &session.harness);
        if matches!(kind, AgentKind::InMemory | AgentKind::SandboxedCoder) {
            self.admit_owner(kind, session.owner_user()?).await?;
        }
        Ok(())
    }

    /// Access checks precede admission, including on the forwarding replica.
    pub(super) async fn admit_command(
        &self,
        session_id: AgentSessionId,
        command: &HarnessCommand,
    ) -> Result<Option<CommandOutcome>> {
        match command {
            HarnessCommand::Open(open)
                if AgentKind::of(open.bot_id) == AgentKind::SandboxedCoder
                    && !is_macro_staff(&open.origin.sender) =>
            {
                return Err(AgentSessionError::Forbidden.into());
            }
            HarnessCommand::Deliver(DeliverAction {
                actor,
                action: AgentAction::RespondToPermission(_),
                ..
            }) => {
                if actor.is_none() {
                    return Err(AgentSessionError::Forbidden.into());
                }
            }
            HarnessCommand::Deliver(DeliverAction { actor, .. })
            | HarnessCommand::EditQueued { actor, .. }
            | HarnessCommand::RemoveQueued { actor, .. } => {
                let session = self.sessions.get_session(session_id).await?;
                if AgentKind::for_session(session.bot_id, &session.harness)
                    == AgentKind::ClaudeCloud
                    && !actor
                        .as_ref()
                        .is_some_and(|actor| session.owner_id.is_user(actor))
                {
                    return Err(AgentSessionError::Forbidden.into());
                }
                if AgentKind::of(session.bot_id) == AgentKind::SandboxedCoder
                    && !actor.as_ref().is_some_and(is_macro_staff)
                {
                    return Err(AgentSessionError::Forbidden.into());
                }
            }
            _ => {}
        }

        let HarnessCommand::Deliver(deliver) = command else {
            return Ok(None);
        };
        if !deliver.action.occupies_turn() {
            return Ok(None);
        }
        if let Some(origin) = &deliver.announce {
            let actor = deliver.actor.as_ref().ok_or(AgentSessionError::Forbidden)?;
            self.prompt_context.authorize_origin(actor, origin).await?;
        }
        if self
            .busy
            .turn(session_id)
            .is_some_and(|turn| turn.action_id == deliver.id)
        {
            return Ok(Some(CommandOutcome::Completed));
        }
        if self.queues.contains(session_id, deliver.id) {
            return Ok(Some(CommandOutcome::Queued));
        }
        if let Err(error) = self.admit_session(session_id).await {
            // A forwarding replica has no local busy record. A persisted, still
            // running action is an idempotent acknowledgement, not new spending.
            if self
                .running_action(session_id, deliver.id)
                .await
                .inspect_err(|error| tracing::warn!(error = ?error, %session_id, "failed to recognize an action retry"))
                .unwrap_or(false)
            {
                return Ok(Some(CommandOutcome::Completed));
            }
            return Err(error);
        }
        Ok(None)
    }

    async fn running_action(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
    ) -> Result<bool> {
        use agent_fold::domain::fold::FoldMachineImpl;
        use agent_fold::domain::model::{Author, Control, MessagePart, TurnState};
        use agent_fold::domain::ports::FoldMachine;

        let log = self.sessions.session_log(session_id).await?;
        let mut fold = FoldMachineImpl::new();
        for entry in log.entries {
            let _ = fold.push(entry.entry);
        }
        if !matches!(
            fold.metadata().turn,
            TurnState::Running | TurnState::Starting | TurnState::Stopping | TurnState::Blocked
        ) {
            return Ok(false);
        }
        Ok(fold
            .messages()
            .iter()
            .rev()
            .find(|message| {
                matches!(message.author, Author::User { .. })
                    && message.parts.iter().any(|part| {
                        matches!(
                            part,
                            MessagePart::Text { .. }
                                | MessagePart::Attachment { .. }
                                | MessagePart::Control {
                                    control: Control::Compact,
                                    ..
                                }
                        )
                    })
            })
            .is_some_and(|message| message.request_id == Some(action_id)))
    }

    /// A quota denial is terminal for all waiting work billed to this owner.
    /// Broker events retain the action id and public reason without inventing a
    /// runtime turn or exposing internal billing diagnostics. An outage leaves
    /// the head queued for a later explicit attempt, never a background spin.
    pub(super) async fn failed_dispatch(
        &self,
        session_id: AgentSessionId,
        entry: QueuedEntry,
        error: &HarnessError,
    ) {
        self.busy.clear(session_id);
        let Some(reason) = denial(error) else {
            self.queues.requeue_front(session_id, entry);
            return;
        };
        let mut rejected = Some(entry);
        while let Some(entry) = rejected {
            self.publish_rejection(session_id, entry.action_id, reason)
                .await;
            rejected = self.queues.claim_next(session_id);
        }
    }

    /// The forwarding replica has already acknowledged this action. Its
    /// refusal here must remain observable even though no queue entry exists.
    pub(super) async fn reject_forwarded(
        &self,
        session_id: AgentSessionId,
        command: &HarnessCommand,
        error: &HarnessError,
    ) {
        if let HarnessCommand::Deliver(deliver) = command
            && deliver.action.occupies_turn()
            && let Some(reason) = denial(error)
        {
            self.publish_rejection(session_id, deliver.id, reason).await;
        }
    }

    async fn publish_rejection(
        &self,
        session_id: AgentSessionId,
        action_id: AgentActionId,
        reason: DenyReason,
    ) {
        self.publish_lifecycle(session_id, |identity| {
            AgentSessionLifecycleEvent::CommandRejected(CommandRejectedMetadata {
                identity,
                action_id,
                code: reason.code().to_owned(),
                error: reason.message().to_owned(),
            })
        })
        .await;
    }
}

fn denial(error: &HarnessError) -> Option<DenyReason> {
    match error {
        HarnessError::Admission(AiAdmissionError::Denied(reason))
        | HarnessError::Session(AgentSessionError::Admission(AiAdmissionError::Denied(reason))) => {
            Some(*reason)
        }
        _ => None,
    }
}
