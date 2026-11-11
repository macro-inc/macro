use std::io::ErrorKind;
use std::time::Duration;

use super::TransportFailure;

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
        let error = std::io::Error::from(kind);
        assert_eq!(TransportFailure::classify(&error), expected, "{kind:?}");
    }
}

#[test]
fn a_non_transport_error_classifies_as_other() {
    let json_error = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
    assert_eq!(
        TransportFailure::classify(&json_error),
        TransportFailure::Other
    );
}

#[tokio::test]
async fn a_refused_connection_is_a_connect_failure() {
    let address = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    // The listener is dropped, so nothing accepts on this port.
    let error = reqwest::get(format!("http://{address}")).await.unwrap_err();

    assert_eq!(TransportFailure::classify(&error), TransportFailure::Connect);
}

#[tokio::test]
async fn a_request_past_its_deadline_is_a_timeout() {
    // Never accepted: the kernel completes the handshake and nothing answers.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let http = reqwest::Client::builder()
        .timeout(Duration::from_millis(100))
        .build()
        .unwrap();

    let error = http
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap_err();
    drop(listener);

    assert_eq!(TransportFailure::classify(&error), TransportFailure::Timeout);
}
