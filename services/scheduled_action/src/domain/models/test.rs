use serde_json::json;

use super::RunTranscript;

#[test]
fn a_legacy_chat_is_kind_and_id() {
    let transcript = RunTranscript::LegacyChat("chat-42".to_owned());

    assert_eq!(
        serde_json::to_value(&transcript).expect("legacy chats serialize"),
        json!({ "kind": "legacy_chat", "id": "chat-42" })
    );
    assert_eq!(
        serde_json::from_value::<RunTranscript>(json!({
            "kind": "legacy_chat",
            "id": "chat-42"
        }))
        .expect("legacy chats deserialize"),
        transcript
    );
}

#[test]
fn an_agent_session_is_kind_and_id() {
    let session_id = macro_uuid::generate_uuid_v7();
    let transcript = RunTranscript::AgentSession(session_id);

    assert_eq!(
        serde_json::to_value(&transcript).expect("sessions serialize"),
        json!({ "kind": "agent_session", "id": session_id.to_string() })
    );
    assert_eq!(
        serde_json::from_value::<RunTranscript>(json!({
            "kind": "agent_session",
            "id": session_id.to_string()
        }))
        .expect("sessions deserialize"),
        transcript
    );
}
