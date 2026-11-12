use serde_json::json;
use strum::IntoEnumIterator as _;

use super::*;

#[test]
fn operation_string_forms_agree_with_serde() {
    for operation in OpensearchOperation::iter() {
        let name: &'static str = operation.into();
        assert_eq!(operation.to_string(), name);
        assert_eq!(operation.as_ref(), name);
        assert_eq!(serde_json::to_value(operation).unwrap(), json!(name));
    }
    assert_eq!(
        OpensearchOperation::ReconcileAgentSessionParent.to_string(),
        "reconcile_agent_session_parent"
    );
    assert_eq!(
        OpensearchOperation::DeleteCallRecordsByChannelId.as_ref(),
        "delete_call_records_by_channel_id"
    );
}

#[test]
fn request_failure_names_its_operation_and_cause_in_logs_and_json() {
    let error = OpensearchClientError::RequestFailed {
        details: "error sending request: connection closed before message completed".to_owned(),
        cause: TransportFailure::ConnectionClosed,
        operation: OpensearchOperation::SearchUnified,
    };

    assert_eq!(
        error.to_string(),
        "request to opensearch failed. operation: search_unified cause: connection_closed \
         details: error sending request: connection closed before message completed"
    );
    assert_eq!(
        serde_json::to_value(&error).unwrap(),
        json!({
            "type": "RequestFailed",
            "details": "error sending request: connection closed before message completed",
            "cause": "connection_closed",
            "operation": "search_unified",
        })
    );
}

#[tokio::test]
async fn a_refused_connection_is_reported_as_a_connect_failure() {
    let address = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    // The listener is dropped, so nothing accepts on this port.
    let client =
        crate::OpensearchClient::new(format!("http://{address}"), "".into(), "".into()).unwrap();

    let result = client.delete_agent_session("session-1", None).await;

    let Err(OpensearchClientError::RequestFailed {
        details,
        cause,
        operation,
    }) = result
    else {
        panic!("expected a request failure, got {result:?}");
    };
    assert_eq!(operation, OpensearchOperation::DeleteAgentSession);
    assert_eq!(cause, TransportFailure::Connect);
    assert!(details.contains("error sending request"), "{details}");
}
