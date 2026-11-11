use super::*;
use crate::domain::model::AgentSessionId;

#[test]
fn an_empty_prompt_still_proves_delivery() {
    let session = AgentSessionId::new();
    let action = AgentActionId::mint();
    let log = format!(
        r#"{{"direction":"to_runtime","content":{{"type":"acp","jsonrpc":"2.0","id":"{action}","method":"session/prompt","params":{{"sessionId":"s1","prompt":[]}}}}}}"#
    );
    let entries = agent_fold::testing::parse_log_as(session, &log)
        .into_iter()
        .map(|entry| StoredAgentSessionLog {
            id: macro_uuid::generate_uuid_v7(),
            created_at: chrono::Utc::now(),
            entry,
        })
        .collect();
    assert_eq!(
        recorded_action(entries, action),
        Some(RecordedAction::Running {
            turn: TurnId(0),
            actor: Some(
                macro_user_id::user_id::MacroUserIdStr::try_from_email("eric@example.com").unwrap(),
            ),
        })
    );
}

#[test]
fn an_empty_prompt_recovers_its_completed_answer() {
    let session = AgentSessionId::new();
    let action = AgentActionId::mint();
    let log = agent_fold::testing::TURN
        .replace("prompt-1", &action.to_string())
        .replace("list the examples and write a file", "");
    let entries = agent_fold::testing::parse_log_as(session, &log)
        .into_iter()
        .map(|entry| StoredAgentSessionLog {
            id: macro_uuid::generate_uuid_v7(),
            created_at: chrono::Utc::now(),
            entry,
        })
        .collect();
    assert_eq!(
        recorded_action(entries, action),
        Some(RecordedAction::Finished {
            notification_noop: false,
            turn: TurnId(0),
            stop: StopReason::EndTurn,
            last_text: Some("Done.".into()),
        })
    );
}
