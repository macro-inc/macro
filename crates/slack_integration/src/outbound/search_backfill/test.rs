use super::*;
use crate::outbound::test_support::mock_http;
use chrono::Utc;

fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn request() -> SearchBackfill {
    SearchBackfill {
        job_id: Uuid::now_v7().try_into().unwrap(),
        channel_ids: vec![Uuid::now_v7()],
        generation: 4,
        state: SearchState::Pending,
        updated_at: Utc::now(),
    }
}

#[tokio::test]
async fn submits_exact_scope_with_auth_and_polls_actual_receipt_until_publication() {
    let id = Uuid::now_v7();
    let (endpoint, requests) = mock_http(vec![
        response("202 Accepted", &format!(r#"{{"job_id":"{id}"}}"#)),
        response(
            "200 OK",
            &format!(r#"{{"job_id":"{id}","status":"running","enqueued":5}}"#),
        ),
        response(
            "200 OK",
            &format!(r#"{{"job_id":"{id}","status":"completed","enqueued":10}}"#),
        ),
    ]);
    let client = HttpSearchBackfill::new(&endpoint, "test-internal-key").unwrap();
    let scope = request();
    assert_eq!(client.submit(&scope).await.unwrap(), id);
    assert_eq!(
        client.progress(id).await.unwrap(),
        SearchState::Submitted { receipt_id: id }
    );
    assert_eq!(client.progress(id).await.unwrap(), SearchState::Completed);
    let post = requests.recv().unwrap();
    assert!(post.starts_with("POST /internal/backfill/channels "));
    assert!(
        post.to_lowercase()
            .contains("x-internal-auth-key: test-internal-key")
    );
    let body: serde_json::Value =
        serde_json::from_str(post.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"channel_ids": scope.channel_ids, "deletion_filter":"any"})
    );
    for _ in 0..2 {
        assert!(
            requests
                .recv()
                .unwrap()
                .starts_with(&format!("GET /internal/backfill/{id} "))
        );
    }
}

#[tokio::test]
async fn missing_failed_cancelled_and_transient_receipts_are_not_completed() {
    let id = Uuid::now_v7();
    let (endpoint, _) = mock_http(vec![
        response("404 Not Found", "unknown job id"),
        response(
            "200 OK",
            &format!(r#"{{"job_id":"{id}","status":"failed","error":"provider details"}}"#),
        ),
        response(
            "200 OK",
            &format!(r#"{{"job_id":"{id}","status":"cancelled"}}"#),
        ),
        response("503 Service Unavailable", "provider details"),
        response(
            "200 OK",
            &format!(r#"{{"job_id":"{}","status":"completed"}}"#, Uuid::now_v7()),
        ),
        response("200 OK", "invalid json"),
    ]);
    let client = HttpSearchBackfill::new(&endpoint, "test-key").unwrap();
    for _ in 0..3 {
        assert_eq!(client.progress(id).await.unwrap(), SearchState::Failed);
    }
    for _ in 0..3 {
        assert_eq!(
            client
                .progress(id)
                .await
                .unwrap_err()
                .into_current_context(),
            ImportError::Retryable
        );
    }
}

#[tokio::test]
async fn submit_does_not_confuse_success_status_or_invalid_body_with_acceptance() {
    let (endpoint, _) = mock_http(vec![
        response("200 OK", &format!(r#"{{"job_id":"{}"}}"#, Uuid::now_v7())),
        response("202 Accepted", r#"{"job_id":"not-a-receipt"}"#),
        response(
            "202 Accepted",
            &format!(r#"{{"job_id":"{}"}}"#, Uuid::nil()),
        ),
        response("202 Accepted", &"x".repeat(RESPONSE_BYTES + 1)),
    ]);
    let client = HttpSearchBackfill::new(&endpoint, "test-key").unwrap();
    for _ in 0..4 {
        assert_eq!(
            client
                .submit(&request())
                .await
                .unwrap_err()
                .into_current_context(),
            ImportError::Retryable
        );
    }
}

#[tokio::test]
async fn empty_scope_is_never_a_global_backfill() {
    let client = HttpSearchBackfill::new("http://127.0.0.1:1", "test-key").unwrap();
    let mut request = request();
    request.channel_ids.clear();
    assert_eq!(
        client
            .submit(&request)
            .await
            .unwrap_err()
            .into_current_context(),
        ImportError::InvalidInput
    );
}

#[test]
fn invalid_configuration_fails_at_construction() {
    for base in [
        "file:///tmp/search",
        "https://example.test/?key=secret",
        "https://user:password@example.test",
        "https://example.test/#fragment",
    ] {
        assert!(HttpSearchBackfill::new(base, "key").is_err());
    }
    assert!(HttpSearchBackfill::new("https://example.test", "").is_err());
    assert!(HttpSearchBackfill::new("https://example.test", "bad\nkey").is_err());
}
