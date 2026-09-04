use super::*;

#[test]
fn a_request_with_trace_context_round_trips() {
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
    };

    let payload = serde_json::to_string(&request).expect("request serializes");
    let decoded: RuntimeCommandRequest =
        serde_json::from_str(&payload).expect("request deserializes");

    assert_eq!(decoded.request_id(), request.request_id());
    assert_eq!(decoded.trace_context, request.trace_context);
}
