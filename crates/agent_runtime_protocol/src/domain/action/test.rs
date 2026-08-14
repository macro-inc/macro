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
fn set_model_becomes_a_model_config_option_request() {
    let session_id = SessionId::new("acp-abc");
    let translated = AgentAction::set_model("opus")
        .to_runtime(&session_id, RequestId::Str("harness:model:0".to_owned()))
        .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = translated else {
        panic!("a model change translates to an ACP request");
    };

    assert_eq!(request.id, RequestId::Str("harness:model:0".to_owned()));

    let parsed: ClientRequest =
        ClientRequest::parse_message(&request.method, &request.params).unwrap();
    let ClientRequest::SetSessionConfigOptionRequest(parsed) = parsed else {
        panic!("a model change translates to SetSessionConfigOptionRequest");
    };
    assert_eq!(parsed.session_id, session_id);
    assert_eq!(parsed.config_id.to_string(), MODEL_CONFIG_ID);
    assert_eq!(parsed.value.as_value_id().unwrap().to_string(), "opus");

    let message = ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request)));
    let (parsed_session_id, parsed) = AgentSetModelAction::from_runtime(&message).unwrap();
    assert_eq!(parsed_session_id, session_id);
    assert_eq!(
        parsed,
        AgentSetModelAction {
            model: "opus".into()
        }
    );
    assert_eq!(
        AgentAction::control_from_runtime(&message),
        Some(AgentAction::set_model("opus"))
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
    let message = ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Notification(notification)));
    assert_eq!(
        AgentAction::control_from_runtime(&message),
        Some(AgentAction::Stop)
    );
}

#[test]
fn compact_becomes_opencodes_compact_prompt() {
    let session_id = SessionId::new("acp-abc");
    let translated = AgentAction::Compact
        .to_runtime(&session_id, RequestId::Str("harness:compact:0".to_owned()))
        .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = translated else {
        panic!("compact translates to an ACP request");
    };
    let parsed: ClientRequest =
        ClientRequest::parse_message(&request.method, &request.params).unwrap();
    let ClientRequest::PromptRequest(parsed) = parsed else {
        panic!("compact translates to PromptRequest, got {parsed:?}");
    };
    assert_eq!(parsed.session_id, session_id);
    assert_eq!(parsed.prompt, vec![ContentBlock::from(COMPACT_COMMAND)]);
    let message = AgentAction::Compact
        .to_runtime(&session_id, RequestId::Str("compact:1".to_owned()))
        .unwrap();
    assert_eq!(
        AgentAction::control_from_runtime(&message),
        Some(AgentAction::Compact)
    );
}

#[test]
fn action_ids_survive_the_trip_through_a_request_id() {
    let id = AgentActionId::mint();
    assert_eq!(
        AgentActionId::from_request_id(&id.to_request_id()),
        Some(id)
    );
}

#[test]
fn foreign_request_ids_are_not_action_ids() {
    // Zed's bare uuids, the harness's own counters, numeric ids: none of
    // them were minted by the control plane.
    let foreign = RequestId::Str("813ea7f3-b8e1-4af3-b2f4-44f4f445637a".to_owned());
    assert_eq!(AgentActionId::from_request_id(&foreign), None);
}

#[test]
fn action_ids_serialize_as_their_bare_string() {
    let id = AgentActionId::mint();
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, format!("\"{id}\""));
}

#[test]
fn only_stop_supersedes_what_is_already_queued() {
    assert!(AgentAction::Stop.supersedes_queued());
    assert!(!AgentAction::prompt("keep going").supersedes_queued());
    assert!(!AgentAction::set_model("opus").supersedes_queued());
    assert!(!AgentAction::Compact.supersedes_queued());
}
