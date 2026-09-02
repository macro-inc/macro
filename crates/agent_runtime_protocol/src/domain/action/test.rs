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
    assert!(
        !AgentAction::respond_elicitation(
            ElicitationRequestId::Number(0),
            ElicitationAnswer::Cancel
        )
        .occupies_turn(),
        "an answer rides alongside the turn that is waiting on it"
    );
}

#[test]
fn an_elicitation_answer_is_a_response_on_the_agents_own_id() {
    use agent_client_protocol::schema::v1::{
        CreateElicitationResponse, ElicitationAction, ElicitationContentValue, Response,
    };

    let session_id = SessionId::new("acp-abc");
    let content = BTreeMap::from([
        ("strategy".to_owned(), serde_json::json!("balanced")),
        ("port".to_owned(), serde_json::json!(3000)),
        ("ratio".to_owned(), serde_json::json!(0.5)),
        ("logging".to_owned(), serde_json::json!(true)),
        ("colours".to_owned(), serde_json::json!(["red", "blue"])),
    ]);
    let translated = AgentAction::respond_elicitation(
        ElicitationRequestId::Number(0),
        ElicitationAnswer::Accept {
            content: Some(content),
        },
    )
    .to_runtime(
        &session_id,
        RequestId::Str("agent_session:ignored".to_owned()),
    )
    .unwrap();

    // Claude Code numbers its elicitations from 0; the answer must echo that
    // id exactly, not the minted action id.
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(Response::Result {
        id,
        result,
    }))) = translated
    else {
        panic!("an elicitation answer translates to a JSON-RPC result");
    };
    assert_eq!(id, RequestId::Number(0));

    let response: CreateElicitationResponse = serde_json::from_value(result).unwrap();
    let ElicitationAction::Accept(accept) = response.action else {
        panic!("accept round-trips as accept, got {:?}", response.action);
    };
    let content = accept.content.unwrap();
    assert_eq!(
        content["strategy"],
        ElicitationContentValue::String("balanced".to_owned())
    );
    assert_eq!(content["port"], ElicitationContentValue::Integer(3000));
    assert_eq!(content["ratio"], ElicitationContentValue::Number(0.5));
    assert_eq!(content["logging"], ElicitationContentValue::Boolean(true));
    assert_eq!(
        content["colours"],
        ElicitationContentValue::StringArray(vec!["red".to_owned(), "blue".to_owned()])
    );
}

#[test]
fn decline_and_cancel_carry_no_content_and_string_ids_survive() {
    use agent_client_protocol::schema::v1::Response;

    for (answer, action) in [
        (ElicitationAnswer::Decline, "decline"),
        (ElicitationAnswer::Cancel, "cancel"),
    ] {
        let translated =
            AgentAction::respond_elicitation(ElicitationRequestId::Str("el-7".to_owned()), answer)
                .to_runtime(
                    &SessionId::new("acp-abc"),
                    RequestId::Str("unused".to_owned()),
                )
                .unwrap();
        let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(Response::Result {
            id,
            result,
        }))) = translated
        else {
            panic!("an elicitation answer translates to a JSON-RPC result");
        };
        assert_eq!(id, RequestId::Str("el-7".to_owned()));
        assert_eq!(result, serde_json::json!({ "action": action }));
    }
}

#[test]
fn nested_content_is_refused_before_it_reaches_the_wire() {
    let translated = AgentAction::respond_elicitation(
        ElicitationRequestId::Number(1),
        ElicitationAnswer::Accept {
            content: Some(BTreeMap::from([(
                "nested".to_owned(),
                serde_json::json!({ "a": 1 }),
            )])),
        },
    )
    .to_runtime(
        &SessionId::new("acp-abc"),
        RequestId::Str("unused".to_owned()),
    );
    assert!(matches!(translated, Err(ActionError::Acp(_))));
}

#[test]
fn the_control_body_for_an_answer_reads_as_documented() {
    let action: AgentAction = serde_json::from_value(serde_json::json!({
        "type": "respondElicitation",
        "requestId": 43,
        "action": "accept",
        "content": { "strategy": "balanced" }
    }))
    .unwrap();
    assert_eq!(
        action,
        AgentAction::respond_elicitation(
            ElicitationRequestId::Number(43),
            ElicitationAnswer::Accept {
                content: Some(BTreeMap::from([(
                    "strategy".to_owned(),
                    serde_json::json!("balanced")
                )])),
            },
        )
    );

    let action: AgentAction = serde_json::from_value(serde_json::json!({
        "type": "respondElicitation",
        "requestId": "el-7",
        "action": "decline"
    }))
    .unwrap();
    assert_eq!(
        action,
        AgentAction::respond_elicitation(
            ElicitationRequestId::Str("el-7".to_owned()),
            ElicitationAnswer::Decline,
        )
    );
    assert_eq!(
        serde_json::to_value(&action).unwrap(),
        serde_json::json!({ "type": "respondElicitation", "requestId": "el-7", "action": "decline" })
    );
}

#[test]
fn elicitation_ids_round_trip_and_null_is_unanswerable() {
    assert_eq!(
        ElicitationRequestId::from_request_id(&RequestId::Number(0)),
        Some(ElicitationRequestId::Number(0))
    );
    assert_eq!(
        ElicitationRequestId::from_request_id(&RequestId::Str("x".to_owned()))
            .map(|id| id.to_request_id()),
        Some(RequestId::Str("x".to_owned()))
    );
    assert_eq!(
        ElicitationRequestId::from_request_id(&RequestId::Null),
        None
    );
}
