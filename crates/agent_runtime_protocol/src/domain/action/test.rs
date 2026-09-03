use agent_client_protocol::schema::v1::{ClientRequest, ContentBlock, Response, SessionId};

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
fn non_uuid_request_ids_are_not_action_ids() {
    // The harness's own handshake counters and numeric ids were not minted by
    // the control plane. (A foreign client's bare uuid is indistinguishable
    // from ours by design: only this side writes ToRuntime frames in
    // production, so uuid-shaped is treated as ours.)
    let handshake = RequestId::Str(format!(
        "agent_session:{}:0",
        macro_uuid::generate_uuid_v7()
    ));
    assert_eq!(AgentActionId::from_request_id(&handshake), None);
    assert_eq!(
        AgentActionId::from_request_id(&RequestId::Number(7)),
        None,
        "numeric ids are never ours"
    );
    let counter = RequestId::Str("harness:prompt:0".to_owned());
    assert_eq!(AgentActionId::from_request_id(&counter), None);
}

#[test]
fn only_prompt_shaped_actions_occupy_a_turn() {
    assert!(AgentAction::prompt("keep going").occupies_turn());
    assert!(AgentAction::Compact.occupies_turn());
    assert!(!AgentAction::set_model("opus").occupies_turn());
    assert!(!AgentAction::Stop.occupies_turn());
    assert!(!permission_answer(RequestId::Number(7)).occupies_turn());
}

#[test]
fn a_permission_answer_becomes_a_response_carrying_the_agents_request_id() {
    let session_id = SessionId::new("acp-abc");
    let translated = permission_answer(RequestId::Number(7))
        .to_runtime(&session_id, RequestId::Str("minted-and-ignored".to_owned()))
        .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(Response::Result {
        id,
        result,
    }))) = translated
    else {
        panic!("a permission answer translates to a successful ACP response");
    };
    assert_eq!(id, RequestId::Number(7));
    let response: RequestPermissionResponse = serde_json::from_value(result).unwrap();
    assert_eq!(
        response.outcome,
        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new("allow"))
    );

    let message =
        ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(Response::Result {
            id: RequestId::Number(7),
            result: serde_json::json!({}),
        })));
    assert_eq!(AgentAction::control_from_runtime(&message), None);
}

#[test]
fn a_permission_answer_round_trips_through_json_keeping_the_ids_shape() {
    let numeric = permission_answer(RequestId::Number(7));
    let json = serde_json::to_value(&numeric).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "type": "respondToPermission",
            "requestId": 7,
            "answer": { "kind": "selected", "optionId": "allow" },
        })
    );
    assert_eq!(
        serde_json::from_value::<AgentAction>(json).unwrap(),
        numeric
    );

    let cancelled = AgentAction::RespondToPermission(AgentPermissionAction {
        request_id: RequestId::Str("req-1".to_owned()),
        answer: PermissionAnswer::Cancelled,
    });
    let json = serde_json::to_value(&cancelled).unwrap();
    assert_eq!(json["requestId"], serde_json::json!("req-1"));
    assert_eq!(json["answer"], serde_json::json!({ "kind": "cancelled" }));
    assert_eq!(
        serde_json::from_value::<AgentAction>(json).unwrap(),
        cancelled
    );
}

fn permission_answer(request_id: RequestId) -> AgentAction {
    AgentAction::RespondToPermission(AgentPermissionAction {
        request_id,
        answer: PermissionAnswer::Selected {
            option_id: "allow".to_owned(),
        },
    })
}
