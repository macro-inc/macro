use super::*;

#[test]
fn sandbox_list_deserializes_the_paginated_daytona_response() {
    let response = serde_json::json!({
        "items": [{
            "id": "sandbox-1",
            "state": "started",
            "errorReason": null,
            "labels": {
                "macro.agent_session_id": "session-1"
            }
        }],
        "nextCursor": null
    });

    let response: SandboxListDto =
        serde_json::from_value(response).expect("Daytona's sandbox list response should parse");

    assert_eq!(response.items.len(), 1);
    assert_eq!(response.items[0].id, "sandbox-1");
    assert_eq!(response.items[0].state, SandboxState::Started);
}
