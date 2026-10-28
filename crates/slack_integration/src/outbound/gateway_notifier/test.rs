use super::*;
use crate::outbound::test_support::mock_http;
use connection_gateway_client::models::SendMessageBody;
use uuid::Uuid;

fn team() -> TeamId {
    Uuid::from_u128(1).try_into().unwrap()
}
fn job() -> JobId {
    Uuid::from_u128(2).try_into().unwrap()
}

#[test]
fn throttle_deduplicates_versions_and_allows_status_transitions() {
    let mut throttle = Throttle::default();
    let now = Instant::now();
    assert!(throttle.admit(team(), job(), 1, JobStatus::Uploading, now));
    assert!(!throttle.admit(
        team(),
        job(),
        1,
        JobStatus::Uploading,
        now + THROTTLE_INTERVAL
    ));
    assert!(!throttle.admit(team(), job(), 2, JobStatus::Uploading, now));
    assert!(throttle.admit(
        team(),
        job(),
        2,
        JobStatus::Uploading,
        now + THROTTLE_INTERVAL
    ));
    assert!(!throttle.admit(
        team(),
        job(),
        1,
        JobStatus::Uploading,
        now + THROTTLE_INTERVAL
    ));
    assert!(throttle.admit(
        team(),
        job(),
        3,
        JobStatus::Completed,
        now + THROTTLE_INTERVAL
    ));
    assert!(!throttle.admit(
        team(),
        job(),
        3,
        JobStatus::Completed,
        now + THROTTLE_INTERVAL
    ));
}

#[test]
fn throttle_memory_is_bounded_and_entries_expire() {
    let mut throttle = Throttle::default();
    let now = Instant::now();
    for id in 1..=MAX_TRACKED_JOBS {
        assert!(throttle.admit(
            team(),
            Uuid::from_u128(id as u128).try_into().unwrap(),
            0,
            JobStatus::Uploading,
            now
        ));
    }
    let extra = Uuid::from_u128(MAX_TRACKED_JOBS as u128 + 1)
        .try_into()
        .unwrap();
    assert!(!throttle.admit(team(), extra, 0, JobStatus::Uploading, now));
    assert_eq!(throttle.sent.len(), MAX_TRACKED_JOBS);
    assert!(throttle.admit(team(), extra, 1, JobStatus::Uploading, now + RETENTION));
    assert_eq!(throttle.sent.len(), 1);
}

#[tokio::test]
async fn gateway_uses_requester_entity_and_json_object_for_string_framing() {
    let body = r#"{"receipts":[]}"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let (endpoint, requests) = mock_http(vec![response]);
    let notifier = GatewayImportNotifier::new(Arc::new(ConnectionGatewayClient::new(
        "test".into(),
        endpoint,
    )));
    let requester = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    notifier
        .invalidate(&requester, team(), job(), 9, JobStatus::Processing)
        .await
        .unwrap();
    // Clones share throttling, including duplicate revisions.
    notifier
        .clone()
        .invalidate(&requester, team(), job(), 9, JobStatus::Processing)
        .await
        .unwrap();
    let request = requests.recv_timeout(Duration::from_secs(2)).unwrap();
    let (headers, body) = request.split_once("\r\n\r\n").unwrap();
    assert!(headers.starts_with("POST /message/send/user/macro|admin@example.com HTTP/1.1"));
    let body: SendMessageBody = serde_json::from_str(body).unwrap();
    assert_eq!(body.message_type, "slack_import_updated");
    assert_eq!(
        body.message,
        serde_json::json!({ "jobId": job(), "teamId": team(), "revision": 9, "status": "processing" })
    );
    assert!(body.message.is_object());
    // services/connection_gateway/src/api/message.rs calls message.to_string()
    // before constructing its websocket Message. The browser JSON.parse(data)
    // must yield the object, not a second encoded JSON string.
    let websocket_data = body.message.to_string();
    assert_eq!(
        serde_json::from_str::<Value>(&websocket_data).unwrap(),
        body.message
    );
}

#[tokio::test]
async fn gateway_failure_is_retryable_and_attempts_are_throttled() {
    let (endpoint, requests) = mock_http(vec![
        "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
    ]);
    let notifier = GatewayImportNotifier::new(Arc::new(ConnectionGatewayClient::new(
        "test".into(),
        endpoint,
    )));
    let requester = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    assert_eq!(
        notifier
            .invalidate(&requester, team(), job(), 1, JobStatus::Uploading)
            .await
            .unwrap_err()
            .into_current_context(),
        ImportError::Retryable
    );
    notifier
        .invalidate(&requester, team(), job(), 2, JobStatus::Uploading)
        .await
        .unwrap();
    assert!(requests.recv_timeout(Duration::from_secs(2)).is_ok());
}
