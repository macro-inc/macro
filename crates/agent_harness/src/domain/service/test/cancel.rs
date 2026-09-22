//! Corrections must never cancel another task or duplicate a replacement.

use super::*;
use agent_session::domain::cancel::{CancelTurn, CancelTurnOutcome, TurnReplacement};

fn cancel_request(target: AgentActionId, replacement: Option<&str>) -> CancelTurn {
    CancelTurn {
        request_id: AgentActionId::mint(),
        expected_action_id: target,
        replacement: replacement.map(|prompt| TurnReplacement {
            action_id: AgentActionId::mint(),
            prompt: prompt.into(),
        }),
    }
}

#[tokio::test]
async fn correction_reserves_next_turn_and_retries_do_not_duplicate_it() {
    let ((service, _, containers, _, _), _) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();
    let first = service.inner.busy.turn(id).unwrap().action_id;
    let waiting = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("ordinary next task"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .unwrap();
    let mut request = cancel_request(first, Some("corrected task"));
    // The voice bridge uses its operation ID for the replacement task too.
    request.replacement.as_mut().unwrap().action_id = request.request_id;
    let replacement = request.replacement.as_ref().unwrap().action_id;
    let outcome = service
        .cancel_turn(id, request.clone(), Some(sender()))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        CancelTurnOutcome::Replaced {
            replacement_action_id: replacement
        }
    );
    assert_eq!(
        service
            .cancel_turn(id, request.clone(), Some(sender()))
            .await
            .unwrap(),
        outcome
    );
    assert_eq!(cancel_count(&agent), 1);
    assert_eq!(
        service
            .queued_controls(id)
            .await
            .unwrap()
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        [replacement, waiting.action_id]
    );

    agent.completes_prompt().await;
    agent.wait_for_requests(4).await;
    assert_eq!(
        prompts(&agent)[1],
        vec![ContentBlock::from("corrected task")]
    );
    assert_eq!(
        service
            .cancel_turn(id, request.clone(), Some(sender()))
            .await
            .unwrap(),
        outcome
    );
    assert_eq!(
        cancel_count(&agent),
        1,
        "a retry after dispatch cannot stop the replacement"
    );
    let stale = cancel_request(first, Some("must not run"));
    assert!(matches!(
        service.cancel_turn(id, stale, Some(sender())).await,
        Err(AgentSessionError::TurnConflict)
    ));
    assert_eq!(cancel_count(&agent), 1);
    assert_eq!(service.queued_controls(id).await.unwrap().len(), 1);

    assert!(matches!(
        service
            .cancel_turn(id, request.clone(), Some(staff_sender()))
            .await,
        Err(AgentSessionError::CancellationConflict)
    ));

    let mut changed = request;
    changed.replacement.as_mut().unwrap().prompt = "different payload".into();
    assert!(matches!(
        service.cancel_turn(id, changed, Some(sender())).await,
        Err(AgentSessionError::CancellationConflict)
    ));
}

#[tokio::test]
async fn cancellation_without_replacement_preserves_waiting_work_and_is_idempotent() {
    let ((service, _, containers, _, _), _) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();
    let target = service.inner.busy.turn(id).unwrap().action_id;
    let waiting = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("unrelated next task"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .unwrap();
    let request = cancel_request(target, None);
    for _ in 0..2 {
        assert_eq!(
            service
                .cancel_turn(id, request.clone(), Some(sender()))
                .await
                .unwrap(),
            CancelTurnOutcome::Stopping
        );
    }
    assert_eq!(cancel_count(&agent), 1);
    assert_eq!(
        service.queued_controls(id).await.unwrap()[0].action_id,
        waiting.action_id
    );

    agent.completes_prompt().await;
    agent.wait_for_requests(4).await;
    assert_eq!(
        prompts(&agent)[1],
        vec![ContentBlock::from("unrelated next task")]
    );
    assert_eq!(
        service
            .cancel_turn(id, request, Some(sender()))
            .await
            .unwrap(),
        CancelTurnOutcome::Stopping
    );
    assert_eq!(cancel_count(&agent), 1);
}

#[tokio::test]
async fn invalid_replacement_does_not_interrupt_the_running_turn() {
    let ((service, _, containers, _, _), _) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let target = service.inner.busy.turn(id).unwrap().action_id;
    for prompt in ["", " \n\t"] {
        assert!(matches!(
            service
                .cancel_turn(id, cancel_request(target, Some(prompt)), Some(sender()))
                .await,
            Err(AgentSessionError::InvalidTurnReplacement)
        ));
    }
    let mut request = cancel_request(target, Some("same task identity"));
    request.replacement.as_mut().unwrap().action_id = target;
    assert!(matches!(
        service.cancel_turn(id, request, Some(sender())).await,
        Err(AgentSessionError::InvalidTurnReplacement)
    ));
    assert_eq!(cancel_count(&container.agent()), 0);
    assert!(service.queued_controls(id).await.unwrap().is_empty());
}

#[tokio::test]
async fn conditional_cancel_obeys_the_existing_sandbox_staff_gate() {
    let (service, _, containers, _, _) = harness();
    let id = AgentSessionId::new();
    let container = live_sandboxed_coder_session(&service, &containers, id).await;
    let target = AgentActionId::mint();
    let result = service
        .cancel_turn(id, cancel_request(target, None), Some(sender()))
        .await;
    assert!(matches!(result, Err(AgentSessionError::Forbidden)));
    assert_eq!(cancel_count(&container.agent()), 0);
}

#[tokio::test]
async fn actor_conflict_rolls_back_the_reserved_correction() {
    let ((service, _, containers, _, _), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();
    let completed_turn = service.inner.busy.turn(id).unwrap();
    let first = completed_turn.action_id;
    agent.completes_prompt().await;
    turns.settled(id).await;
    // Recreate the exact state while a turn-end observer is delayed: the
    // actor consumed A's completion, but the harness still remembers A.
    // Waiting for the observer first keeps the fixture deterministic.
    service.inner.busy.mark_turn(id, completed_turn);
    let request = cancel_request(first, Some("must never dispatch"));
    assert!(matches!(
        service.cancel_turn(id, request, Some(sender())).await,
        Err(AgentSessionError::TurnConflict)
    ));
    assert!(service.queued_controls(id).await.unwrap().is_empty());
    assert_eq!(cancel_count(&agent), 0);
}

#[tokio::test]
async fn reused_replacement_identity_is_rejected_before_cancellation() {
    let ((service, _, containers, _, _), _) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let first = service.inner.busy.turn(id).unwrap().action_id;
    let waiting = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("existing"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .unwrap();
    let mut request = cancel_request(first, Some("changed"));
    request.replacement.as_mut().unwrap().action_id = waiting.action_id;
    assert!(matches!(
        service.cancel_turn(id, request, Some(sender())).await,
        Err(AgentSessionError::CancellationConflict)
    ));
    assert_eq!(cancel_count(&container.agent()), 0);
    assert_eq!(service.queued_controls(id).await.unwrap().len(), 1);
}
