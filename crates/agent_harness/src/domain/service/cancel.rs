//! Conditional interruption serialized with queue admission and turn completion.

use super::*;
use agent_session::domain::cancel::{CancelTurn, CancelTurnOutcome};

/// Per-session bound; losing a receipt still cannot cancel a different turn.
const CANCELLATION_RECEIPTS: usize = 128;

pub(super) struct CancellationReceipt {
    request: CancelTurn,
    actor: Option<MacroUserIdStr<'static>>,
    outcome: CancelTurnOutcome,
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
    pub(super) async fn cancel_turn(
        &self,
        session_id: AgentSessionId,
        request: CancelTurn,
        actor: Option<MacroUserIdStr<'static>>,
    ) -> Result<CancelTurnOutcome> {
        if let Some(receipts) = self.cancellations.get(&session_id)
            && let Some(receipt) = receipts
                .iter()
                .find(|receipt| receipt.request.request_id == request.request_id)
        {
            return if receipt.request == request && receipt.actor == actor {
                Ok(receipt.outcome)
            } else {
                Err(AgentSessionError::CancellationConflict.into())
            };
        }
        if request.request_id == request.expected_action_id {
            return Err(AgentSessionError::CancellationConflict.into());
        }
        if let Some(replacement) = &request.replacement {
            if replacement.prompt.trim().is_empty()
                || replacement.action_id == request.expected_action_id
            {
                return Err(AgentSessionError::InvalidTurnReplacement.into());
            }
            if self.queues.contains(session_id, replacement.action_id)
                || self
                    .busy
                    .turn(session_id)
                    .is_some_and(|turn| turn.action_id == replacement.action_id)
            {
                return Err(AgentSessionError::CancellationConflict.into());
            }
        }
        if !self
            .busy
            .turn(session_id)
            .is_some_and(|turn| turn.action_id == request.expected_action_id)
        {
            return Err(AgentSessionError::TurnConflict.into());
        }

        // Reserve before sending: the cancelled response can arrive immediately,
        // but its queued turn-end cannot dispatch until this command finishes.
        if let Some(replacement) = &request.replacement {
            queue::queue_result(
                self.queues.enqueue_front(
                    session_id,
                    QueuedEntry {
                        action_id: replacement.action_id,
                        action: AgentAction::prompt(replacement.prompt.clone()),
                        actor: actor.clone(),
                        announce: None,
                        announced: None,
                        created_at: chrono::Utc::now(),
                    },
                ),
                session_id,
            )?;
        }
        if let Err(error) = self
            .sessions
            .cancel_turn_action(
                session_id,
                actor.clone(),
                request.expected_action_id,
                request.request_id,
            )
            .await
        {
            // The actor may have consumed A's completion while the harness's
            // TurnEnded is still queued. Its guard rejects before cancelling
            // A's replacement or anyone's pending interaction. Undo reservation.
            if let Some(replacement) = &request.replacement {
                let _ = self.queues.remove(session_id, replacement.action_id);
            }
            return Err(error.into());
        }
        let outcome = match &request.replacement {
            Some(replacement) => {
                self.publish_mentions(
                    session_id,
                    replacement.action_id,
                    actor.clone(),
                    &replacement.prompt,
                )
                .await;
                CancelTurnOutcome::Replaced {
                    replacement_action_id: replacement.action_id,
                }
            }
            None => CancelTurnOutcome::Stopping,
        };
        let mut receipts = self.cancellations.entry(session_id).or_default();
        if receipts.len() == CANCELLATION_RECEIPTS {
            receipts.pop_front();
        }
        receipts.push_back(CancellationReceipt {
            request,
            actor,
            outcome,
        });
        drop(receipts);
        self.publish_queue(session_id).await;
        Ok(outcome)
    }
}
