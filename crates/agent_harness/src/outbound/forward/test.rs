use super::*;

#[test]
fn a_signed_response_cannot_be_replayed_for_another_request() {
    let key = "internal-key";
    let request_id = macro_uuid::Uuid::new_v4();
    let response = SignedRuntimeCommandResponse::new(
        request_id,
        RuntimeCommandResponse::Completed(CommandOutcome::Completed),
        key,
    );

    assert!(response.verify(request_id, key));
    assert!(!response.verify(macro_uuid::Uuid::new_v4(), key));
}

#[test]
fn a_signed_request_with_trace_context_verifies_after_serialization() {
    let key = "internal-key";
    let request = RuntimeCommandRequest {
        request_id: macro_uuid::Uuid::new_v4(),
        target: RuntimeCommandTarget::Harness(HarnessId::TEST_A),
        session: AgentSessionId::TEST_A,
        command: HarnessCommand::Delete,
        trace_context: BTreeMap::from([
            ("tracestate".to_owned(), "vendor=value".to_owned()),
            (
                "traceparent".to_owned(),
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".to_owned(),
            ),
        ]),
        signature: String::new(),
    }
    .signed(key);

    let payload = serde_json::to_string(&request).expect("request serializes");
    let decoded: RuntimeCommandRequest =
        serde_json::from_str(&payload).expect("request deserializes");

    assert!(decoded.verify(key));
}

#[test]
fn a_legacy_request_is_accepted_during_the_rolling_transition() {
    let key = "internal-key";
    let request_id = macro_uuid::Uuid::new_v4();
    let target = RuntimeCommandTarget::Harness(HarnessId::TEST_A);
    let session = AgentSessionId::TEST_A;
    let command = HarnessCommand::Delete;
    let payload = serde_json::json!({
        "request_id": request_id,
        "target": target,
        "session": session,
        "command": command,
        "signature": sign_json(&(request_id, &target, session, &command), key),
    });
    let request: RuntimeCommandRequest =
        serde_json::from_value(payload).expect("legacy request deserializes");

    assert!(request.verify(key));
    assert!(request.trace_context.is_empty());
}

#[test]
fn a_new_request_keeps_the_legacy_signature() {
    #[derive(serde::Deserialize)]
    struct LegacyRequest {
        request_id: macro_uuid::Uuid,
        target: RuntimeCommandTarget,
        session: AgentSessionId,
        command: HarnessCommand,
        signature: String,
    }

    let key = "internal-key";
    let request = RuntimeCommandRequest {
        request_id: macro_uuid::Uuid::new_v4(),
        target: RuntimeCommandTarget::Harness(HarnessId::TEST_A),
        session: AgentSessionId::TEST_A,
        command: HarnessCommand::Delete,
        trace_context: BTreeMap::from([("traceparent".to_owned(), "value".to_owned())]),
        signature: String::new(),
    }
    .signed(key);
    let payload = serde_json::to_string(&request).expect("request serializes");
    let legacy: LegacyRequest =
        serde_json::from_str(&payload).expect("legacy peer ignores trace context");

    assert!(verify_json(
        &(
            legacy.request_id,
            &legacy.target,
            legacy.session,
            &legacy.command,
        ),
        &legacy.signature,
        key,
    ));
}

#[test]
fn a_legacy_response_is_accepted_during_the_rolling_transition() {
    let key = "internal-key";
    let request_id = macro_uuid::Uuid::new_v4();
    let response = RuntimeCommandResponse::Completed(CommandOutcome::Completed);
    let payload = serde_json::json!({
        "response": response,
        "signature": sign_json(&response, key),
    });
    let response: SignedRuntimeCommandResponse =
        serde_json::from_value(payload).expect("legacy response deserializes");

    assert!(response.verify(request_id, key));
}

#[test]
fn a_new_response_keeps_the_legacy_signature() {
    #[derive(serde::Deserialize)]
    struct LegacyResponse {
        response: RuntimeCommandResponse,
        signature: String,
    }

    let key = "internal-key";
    let response = SignedRuntimeCommandResponse::new(
        macro_uuid::Uuid::new_v4(),
        RuntimeCommandResponse::Completed(CommandOutcome::Completed),
        key,
    );
    let payload = serde_json::to_string(&response).expect("response serializes");
    let legacy: LegacyResponse =
        serde_json::from_str(&payload).expect("legacy peer ignores new fields");

    assert!(verify_json(&legacy.response, &legacy.signature, key));
}
