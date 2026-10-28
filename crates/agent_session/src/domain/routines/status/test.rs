use super::*;
use agent_fold::testing::parse_log;
use serde_json::{Value, json};

fn frame(direction: &str, mut content: Value) -> StoredAgentSessionLog {
    content["type"] = json!("acp");
    content["jsonrpc"] = json!("2.0");
    StoredAgentSessionLog {
        id: macro_uuid::generate_uuid_v7(),
        created_at: chrono::Utc::now(),
        entry: parse_log(&json!({"direction": direction, "content": content}).to_string())
            .pop()
            .unwrap(),
    }
}

fn prompt(action: AgentActionId) -> StoredAgentSessionLog {
    frame(
        "to_runtime",
        json!({"id": action, "method": "session/prompt", "params": {
            "sessionId": "s", "prompt": [{"type": "text", "text": "routine task"}]
        }}),
    )
}

fn stop(action: AgentActionId, reason: &str) -> StoredAgentSessionLog {
    frame(
        "to_server",
        json!({"id": action, "result": {"stopReason": reason}}),
    )
}

#[test]
fn classifies_every_stop_reason_from_history() {
    let action = AgentActionId::mint();
    for (reason, expected) in [
        ("end_turn", RoutineActionStatus::Succeeded),
        (
            "cancelled",
            RoutineActionStatus::Failed(RoutineFailureReason::Cancelled),
        ),
        (
            "refusal",
            RoutineActionStatus::Failed(RoutineFailureReason::Refusal),
        ),
        (
            "max_tokens",
            RoutineActionStatus::Failed(RoutineFailureReason::MaxTokens),
        ),
        (
            "max_turn_requests",
            RoutineActionStatus::Failed(RoutineFailureReason::MaxTurnRequests),
        ),
        (
            "future_reason",
            RoutineActionStatus::Failed(RoutineFailureReason::UnknownStopReason),
        ),
    ] {
        assert_eq!(
            action_status(
                vec![prompt(action), stop(action, reason)],
                action,
                &SessionStatus::NoMessages
            ),
            expected,
            "{reason}"
        );
    }
    let failure = frame(
        "to_server",
        json!({"id": action, "error": {"code": -32603, "message": "private runtime detail"}}),
    );
    let status = action_status(
        vec![prompt(action), failure],
        action,
        &SessionStatus::NoMessages,
    );
    assert_eq!(
        status,
        RoutineActionStatus::Failed(RoutineFailureReason::RuntimeError)
    );
    assert!(!serde_json::to_string(&status).unwrap().contains("private"));
}

#[test]
fn completion_before_first_read_survives_later_turns_and_disconnect() {
    let initial = AgentActionId::mint();
    let later = AgentActionId::mint();
    let history = vec![
        prompt(initial),
        stop(initial, "end_turn"),
        prompt(later),
        stop(later, "refusal"),
    ];
    assert_eq!(
        action_status(history.clone(), initial, &SessionStatus::Disconnected),
        RoutineActionStatus::Succeeded
    );
    assert_eq!(
        action_status(history, later, &SessionStatus::Disconnected),
        RoutineActionStatus::Failed(RoutineFailureReason::Refusal)
    );
}

#[test]
fn unrelated_turns_and_connection_state_are_not_completion() {
    let initial = AgentActionId::mint();
    let other = AgentActionId::mint();
    assert_eq!(
        action_status(
            vec![prompt(other), stop(other, "end_turn")],
            initial,
            &SessionStatus::NoMessages
        ),
        RoutineActionStatus::Pending(RoutinePendingReason::AwaitingPrompt)
    );
    assert_eq!(
        action_status(vec![prompt(initial)], initial, &SessionStatus::Disconnected),
        RoutineActionStatus::Pending(RoutinePendingReason::Disconnected)
    );
    assert_eq!(
        action_status(vec![prompt(initial)], initial, &SessionStatus::NoMessages),
        RoutineActionStatus::Pending(RoutinePendingReason::Running)
    );
    for event in [
        agent_runtime_protocol::domain::schema::v0::SystemEvent::AcpReady,
        agent_runtime_protocol::domain::schema::v0::SystemEvent::Unknown("booted".into()),
    ] {
        assert_eq!(
            action_status(vec![], initial, &SessionStatus::Event(event)),
            RoutineActionStatus::Pending(RoutinePendingReason::AwaitingPrompt)
        );
    }
}

#[test]
fn pending_human_interactions_are_nonterminal() {
    let action = AgentActionId::mint();
    for (request, reason) in [
        (
            json!({"id": "permission", "method": "session/request_permission", "params": {
                "sessionId": "s", "toolCall": {"toolCallId": "tool"},
                "options": [{"optionId": "once", "name": "Allow once", "kind": "allow_once"}]
            }}),
            RoutinePendingReason::Permission,
        ),
        (
            json!({"id": "question", "method": "elicitation/create", "params": {
                "sessionId": "s", "mode": "form", "message": "Which?",
                "requestedSchema": {"type": "object", "properties": {}}
            }}),
            RoutinePendingReason::Elicitation,
        ),
        (
            json!({"method": "_macro/tool_approval", "params": {
                "approvalId": "a1", "serverSlug": "macro", "serverName": "Macro",
                "toolName": "WebSearch", "arguments": {}, "status": "pending"
            }}),
            RoutinePendingReason::Permission,
        ),
    ] {
        assert_eq!(
            action_status(
                vec![prompt(action), frame("to_server", request)],
                action,
                &SessionStatus::NoMessages
            ),
            RoutineActionStatus::Pending(reason)
        );
    }
}

#[test]
fn status_contract_round_trips_without_content() {
    for status in [
        RoutineActionStatus::Succeeded,
        RoutineActionStatus::Failed(RoutineFailureReason::Cancelled),
        RoutineActionStatus::Pending(RoutinePendingReason::Permission),
    ] {
        let wire = serde_json::to_string(&status).unwrap();
        assert_eq!(
            serde_json::from_str::<RoutineActionStatus>(&wire).unwrap(),
            status
        );
    }
}
