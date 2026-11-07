use super::*;
use crate::domain::ports::AgentSessionLogWriter as _;
use serde_json::{Value, json};

fn frame(direction: &str, mut content: Value) -> AgentSessionLog {
    content["type"] = json!("acp");
    content["jsonrpc"] = json!("2.0");
    parse_log_as(
        test_session(),
        &json!({"direction": direction, "content": content}).to_string(),
    )
    .remove(0)
}

fn prompt() -> AgentSessionLog {
    frame(
        "to_runtime",
        json!({"id": "prompt", "method": "session/prompt", "params": {
            "sessionId": "s", "prompt": [{"type": "text", "text": "go"}]
        }}),
    )
}

fn permission(id: u64) -> AgentSessionLog {
    frame(
        "to_server",
        json!({"id": id, "method": "session/request_permission", "params": {
            "sessionId": "s", "toolCall": {"toolCallId": "tool"},
            "options": [{"optionId": "once", "name": "Allow once", "kind": "allow_once"}]
        }}),
    )
}

#[tokio::test]
async fn activity_is_durable_and_announced_only_on_transitions() {
    let realtime = RecordingRealtime::new();
    let (repo, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt()).await.unwrap();
    assert_eq!(repo.turn_state(test_session()), Some(TurnState::Running));
    assert_eq!(realtime.updated().len(), 1);

    logs.append(permission(1)).await.unwrap();
    assert_eq!(repo.turn_state(test_session()), Some(TurnState::Blocked));
    logs.append(permission(2)).await.unwrap();
    assert_eq!(realtime.updated().len(), 2);

    for id in [1, 2] {
        logs.append(frame(
            "to_runtime",
            json!({"id": id, "result": {"outcome": {"outcome": "cancelled"}}}),
        ))
        .await
        .unwrap();
        assert_eq!(
            repo.turn_state(test_session()),
            Some(if id == 1 {
                TurnState::Blocked
            } else {
                TurnState::Running
            })
        );
    }
    assert_eq!(realtime.updated().len(), 3);

    logs.append(frame(
        "to_runtime",
        json!({"method": "session/cancel", "params": {"sessionId": "s"}}),
    ))
    .await
    .unwrap();
    assert_eq!(repo.turn_state(test_session()), Some(TurnState::Stopping));
    logs.append(frame(
        "to_server",
        json!({"id": "prompt", "result": {"stopReason": "cancelled"}}),
    ))
    .await
    .unwrap();
    assert_eq!(repo.turn_state(test_session()), Some(TurnState::Idle));
    logs.flush().await.unwrap();
    assert_eq!(
        realtime.published().last().unwrap().turn_state,
        Some(TurnState::Idle)
    );
}

#[tokio::test]
async fn reconnect_projects_the_existing_log_before_publishing_new_frames() {
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(test_agent_session(test_session()));
    AgentSessionLogRepo::create(&repo, prompt()).await.unwrap();
    AgentSessionLogRepo::create(&repo, permission(1))
        .await
        .unwrap();
    assert_eq!(repo.turn_state(test_session()), None);

    let realtime = RecordingRealtime::new();
    let mut logs = LiveSessionLogWriter::new(repo.clone(), realtime.clone());
    logs.append(permission(2)).await.unwrap();
    assert_eq!(repo.turn_state(test_session()), Some(TurnState::Blocked));
    logs.flush().await.unwrap();
    assert_eq!(realtime.published()[0].turn_state, Some(TurnState::Blocked));
    assert_eq!(repo.log_reads(), 1);
}

#[tokio::test]
async fn superseded_writer_cannot_change_activity_or_announce_a_transition() {
    let realtime = RecordingRealtime::new();
    let (repo, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt()).await.unwrap();
    repo.release(logs.claim.as_ref().unwrap()).await.unwrap();
    let _successor = claim_for_test(&repo, test_session()).await;

    assert!(matches!(
        logs.append(permission(1)).await,
        Err(AgentSessionError::FencedOut(_))
    ));
    assert_eq!(repo.turn_state(test_session()), Some(TurnState::Running));
    assert_eq!(realtime.updated().len(), 1);
    assert_eq!(
        AgentSessionLogRepo::list_by_session(&repo, test_session())
            .await
            .unwrap()
            .len(),
        1
    );
}
