use agent_client_protocol::schema::v1::{ClientRequest, ContentBlock, SessionId};

use super::*;

#[test]
fn a_prompt_becomes_a_session_prompt_request_for_the_acp_session() {
    let session_id = SessionId::new("acp-abc");
    let translated = AgentAction::prompt("fix the flaky test")
        .to_runtime(&session_id, RequestId::Str("harness:prompt:0".to_owned()))
        .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = translated else {
        panic!("a prompt translates to an ACP request");
    };

    // The id is the caller's; the method and shape come from the ACP types.
    assert_eq!(request.id, RequestId::Str("harness:prompt:0".to_owned()));

    let parsed: ClientRequest =
        ClientRequest::parse_message(&request.method, &request.params).unwrap();
    let ClientRequest::PromptRequest(parsed) = parsed else {
        panic!("a prompt translates to PromptRequest, got {parsed:?}");
    };

    assert_eq!(parsed.session_id, session_id);
    assert_eq!(parsed.prompt.len(), 1);
    let ContentBlock::Text(text) = &parsed.prompt[0] else {
        panic!("a prompt's content is text");
    };
    assert_eq!(text.text, "fix the flaky test");
}

#[test]
fn set_model_becomes_a_set_model_request_naming_the_acp_session() {
    let session_id = SessionId::new("acp-abc");
    let translated = AgentAction::set_model("opus")
        .to_runtime(&session_id, RequestId::Str("harness:model:0".to_owned()))
        .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = translated else {
        panic!("a model change translates to an ACP request");
    };

    assert_eq!(request.method.as_ref(), "session/set_model");
    assert_eq!(request.id, RequestId::Str("harness:model:0".to_owned()));

    // Hand-built params, so assert on the wire shape rather than a typed parse.
    let params = serde_json::to_value(&request.params).unwrap();
    assert_eq!(params["sessionId"], serde_json::json!("acp-abc"));
    assert_eq!(params["modelId"], serde_json::json!("opus"));

    let message = ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request)));
    let (parsed_session_id, parsed) = AgentSetModelAction::from_runtime(&message).unwrap();
    assert_eq!(parsed_session_id, session_id);
    assert_eq!(
        parsed,
        AgentSetModelAction {
            model: "opus".into()
        }
    );
}

#[test]
fn stop_becomes_a_cancel_notification_with_no_request_id() {
    let session_id = SessionId::new("acp-abc");
    let translated = AgentAction::Stop
        .to_runtime(&session_id, RequestId::Str("unused".to_owned()))
        .unwrap();

    // A notification, not a request: cancelling is not answered, so there is
    // nothing for a response to correlate against.
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Notification(notification))) =
        translated
    else {
        panic!("a stop translates to an ACP notification");
    };

    assert_eq!(notification.method.as_ref(), "session/cancel");
    let params = serde_json::to_value(&notification.params).unwrap();
    assert_eq!(params["sessionId"], serde_json::json!("acp-abc"));
}

#[test]
fn only_stop_supersedes_what_is_already_queued() {
    assert!(AgentAction::Stop.supersedes_queued());
    assert!(!AgentAction::prompt("keep going").supersedes_queued());
    assert!(!AgentAction::set_model("opus").supersedes_queued());
}

#[test]
fn only_a_prompt_is_worth_reconnecting_for() {
    // A prompt is work nobody has done yet; the others are already satisfied
    // by the disconnection or by their durable half.
    assert!(AgentAction::prompt("do the thing").must_reach_agent());
    assert!(!AgentAction::Stop.must_reach_agent());
    assert!(!AgentAction::set_model("opus").must_reach_agent());
}
