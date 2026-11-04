use std::io::ErrorKind;
use std::time::Duration;

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

#[test]
fn io_error_kinds_classify_by_transport_cause() {
    let cases = [
        (ErrorKind::TimedOut, TransportFailure::Timeout),
        (ErrorKind::ConnectionRefused, TransportFailure::Connect),
        (
            ErrorKind::ConnectionReset,
            TransportFailure::ConnectionClosed,
        ),
        (ErrorKind::BrokenPipe, TransportFailure::ConnectionClosed),
        (ErrorKind::UnexpectedEof, TransportFailure::ConnectionClosed),
        (ErrorKind::PermissionDenied, TransportFailure::Other),
    ];
    for (kind, expected) in cases {
        let error = Error::from(std::io::Error::from(kind));
        assert_eq!(TransportFailure::classify(&error), expected, "{kind:?}");
    }
}

#[test]
fn a_non_transport_error_classifies_as_other() {
    let json_error = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
    assert_eq!(
        TransportFailure::classify(&Error::from(json_error)),
        TransportFailure::Other
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

#[tokio::test]
async fn a_request_past_its_deadline_is_reported_as_a_timeout() {
    // Never accepted: the kernel completes the handshake and nothing answers.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let http = reqwest::Client::builder()
        .timeout(Duration::from_millis(100))
        .build()
        .unwrap();

    let reqwest_error = http
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap_err();
    drop(listener);

    assert_eq!(
        TransportFailure::classify(&Error::from(reqwest_error)),
        TransportFailure::Timeout
    );
}
