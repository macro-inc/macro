use super::ElicitationContentValue as ContentValue;
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
fn a_generic_session_config_action_round_trips_through_acp() {
    let session_id = SessionId::new("acp-abc");
    let action = AgentAction::set_config_option("reasoning_effort", "high");
    let translated = action
        .to_runtime(&session_id, RequestId::Str("harness:effort:0".to_owned()))
        .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = &translated else {
        panic!("a config change translates to an ACP request");
    };
    let parsed = ClientRequest::parse_message(&request.method, &request.params).unwrap();
    let ClientRequest::SetSessionConfigOptionRequest(parsed) = parsed else {
        panic!("a config change translates to SetSessionConfigOptionRequest");
    };
    assert_eq!(parsed.session_id, session_id);
    assert_eq!(parsed.config_id.to_string(), "reasoning_effort");
    assert_eq!(parsed.value.as_value_id().unwrap().to_string(), "high");
    assert_eq!(AgentAction::control_from_runtime(&translated), Some(action));
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
        (
            "strategy".to_owned(),
            ContentValue::Text("balanced".to_owned()),
        ),
        ("port".to_owned(), ContentValue::Integer(3000)),
        ("ratio".to_owned(), ContentValue::Number(0.5)),
        ("logging".to_owned(), ContentValue::Boolean(true)),
        (
            "colours".to_owned(),
            ContentValue::Strings(vec!["red".to_owned(), "blue".to_owned()]),
        ),
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

/// A value ACP cannot express is refused where the caller finds out about it -
/// reading the control request - rather than on the way to the wire, by which
/// point the session has already released the elicitation slot and the agent
/// would wait on a request nothing can answer.
#[test]
fn content_acp_cannot_express_is_refused_when_the_request_is_read() {
    for unrepresentable in [
        serde_json::json!({ "a": 1 }),
        serde_json::json!(null),
        serde_json::json!(["a", 1]),
    ] {
        let body = serde_json::json!({
            "type": "respondElicitation",
            "requestId": 1,
            "action": "accept",
            "content": { "field": unrepresentable },
        });
        assert!(
            serde_json::from_value::<AgentAction>(body).is_err(),
            "{unrepresentable} is not an ACP content value"
        );
    }
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
                    ContentValue::Text("balanced".to_owned())
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

#[test]
fn a_prompt_with_attachments_sends_text_then_one_resource_link_each() {
    let session_id = SessionId::new("acp-abc");
    let screenshot = PromptAttachment::new(
        "https://static.example/file/11111111-1111-4111-8111-111111111111",
        "screenshot.png",
    )
    .mime_type("image/png")
    .size(2048);
    let clip = PromptAttachment::new(
        "https://static.example/file/22222222-2222-4222-8222-222222222222",
        "clip.mp4",
    );
    let translated = AgentAction::prompt_with_attachments(
        "what is wrong in this screenshot?",
        vec![screenshot.clone(), clip.clone()],
    )
    .to_runtime(&session_id, RequestId::Str("harness:prompt:1".to_owned()))
    .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = translated else {
        panic!("a prompt translates to an ACP request");
    };
    let ClientRequest::PromptRequest(parsed) =
        ClientRequest::parse_message(&request.method, &request.params).unwrap()
    else {
        panic!("a prompt translates to PromptRequest");
    };

    // Text first, so the links read as belonging to it.
    assert_eq!(parsed.prompt.len(), 3);
    let ContentBlock::Text(text) = &parsed.prompt[0] else {
        panic!("the first block is the prompt text");
    };
    assert_eq!(text.text, "what is wrong in this screenshot?");

    // Every agent must accept resource links, so no capability is checked.
    let ContentBlock::ResourceLink(link) = &parsed.prompt[1] else {
        panic!("an attachment travels as a resource link");
    };
    assert_eq!(link.uri, screenshot.uri);
    assert_eq!(link.name, "screenshot.png");
    assert_eq!(link.mime_type.as_deref(), Some("image/png"));
    assert_eq!(link.size, Some(2048));

    // The logged frame reads back to the same attachments, which is how the
    // fold renders them without a second source of truth.
    let read_back: Vec<PromptAttachment> = parsed
        .prompt
        .iter()
        .filter_map(PromptAttachment::from_content_block)
        .collect();
    assert_eq!(read_back, vec![screenshot, clip]);
}

#[test]
fn a_file_only_prompt_carries_no_text_block_at_all() {
    // The composer allows a send with files and no words. An empty text
    // block would read as an empty prompt to some runtimes, and the fold
    // drops it, so the wire must not carry one either.
    let session_id = SessionId::new("acp-abc");
    let screenshot = PromptAttachment::new(
        "https://static.example/file/11111111-1111-4111-8111-111111111111",
        "screenshot.png",
    )
    .mime_type("image/png");
    let translated = AgentAction::prompt_with_attachments("", vec![screenshot])
        .to_runtime(&session_id, RequestId::Str("harness:prompt:2".to_owned()))
        .unwrap();

    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = translated else {
        panic!("a prompt translates to an ACP request");
    };
    let ClientRequest::PromptRequest(parsed) =
        ClientRequest::parse_message(&request.method, &request.params).unwrap()
    else {
        panic!("a prompt translates to PromptRequest");
    };

    // Just the link: no leading empty text.
    assert_eq!(parsed.prompt.len(), 1);
    assert!(
        matches!(&parsed.prompt[0], ContentBlock::ResourceLink(_)),
        "a file-only prompt is links alone, got {:?}",
        parsed.prompt[0]
    );
}

#[test]
fn attachments_are_optional_on_the_wire() {
    // Clients that predate attachments post `{type, prompt}` and must keep
    // working; and a prompt without attachments must not grow a field every
    // old reader has to learn to ignore.
    let parsed: AgentAction =
        serde_json::from_value(serde_json::json!({ "type": "prompt", "prompt": "hi" })).unwrap();
    assert_eq!(parsed, AgentAction::prompt("hi"));
    let serialized = serde_json::to_value(AgentAction::prompt("hi")).unwrap();
    assert_eq!(
        serialized,
        serde_json::json!({ "type": "prompt", "prompt": "hi" })
    );

    let with = AgentAction::prompt_with_attachments(
        "look",
        vec![PromptAttachment::new("https://x/file/1", "a.png").mime_type("image/png")],
    );
    let json = serde_json::to_value(&with).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "type": "prompt",
            "prompt": "look",
            "attachments": [{ "uri": "https://x/file/1", "name": "a.png", "mimeType": "image/png" }]
        })
    );
    assert_eq!(serde_json::from_value::<AgentAction>(json).unwrap(), with);
}

#[test]
fn a_compact_command_with_attachments_is_still_a_plain_prompt() {
    // Only the text decides whether a prompt is the compaction control; an
    // attached file rides a real prompt, never a control.
    let session_id = SessionId::new("acp-abc");
    let message = AgentAction::prompt_with_attachments(
        COMPACT_COMMAND,
        vec![PromptAttachment::new("https://x/file/1", "a.png")],
    )
    .to_runtime(&session_id, RequestId::Str("p".to_owned()))
    .unwrap();
    // A resource link alongside the text is what makes it a real prompt: the
    // control carries text and nothing else.
    assert_eq!(AgentAction::control_from_runtime(&message), None);
}
