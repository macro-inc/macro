use super::*;
use crate::domain::model::{Author, PermissionOutcome, ToolDetail, ToolStatus, ToolUseId, TurnId};
use non_empty::NonEmpty;
use serde_json::json;

#[test]
fn domain_parts_serialize_directly_into_the_browser_contract() {
    let message = ModelFoldedMessage {
        id: TurnId(3),
        author: Author::Agent,
        request_id: None,
        parts: NonEmpty::one(MessagePart::ToolUse {
            id: ToolUseId("tool-1".to_owned()),
            label: "Bash".to_owned(),
            status: ToolStatus::Running,
            detail: ToolDetail::Terminal {
                command: Some("ls".to_owned()),
                output: None,
                exit_code: None,
            },
            raw_input: Some(Box::new(json!({ "command": "ls" }))),
            raw_output: None,
        }),
        stop: None,
    };
    let session = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(7));

    assert_eq!(
        serde_json::to_value(FoldedMessage::new(session, message)).unwrap(),
        json!({
            "agentSessionId": session.to_string(),
            "turn": 3,
            "author": { "kind": "agent" },
            "requestId": null,
            "parts": [{
                "kind": "tool_use",
                "id": "tool-1",
                "label": "Bash",
                "status": "running",
                "detail": {
                    "kind": "terminal",
                    "command": "ls",
                    "output": null,
                    "exitCode": null
                },
                "rawInput": { "command": "ls" },
                "rawOutput": null
            }],
            "stop": null
        })
    );

    assert_eq!(
        serde_json::to_value(MessagePart::Permission {
            tool_call: ToolUseId("tool-1".to_owned()),
            options: Vec::new(),
            outcome: PermissionOutcome::Pending,
        })
        .unwrap(),
        json!({
            "kind": "permission",
            "toolCall": "tool-1",
            "options": [],
            "outcome": { "kind": "pending" }
        })
    );
}
