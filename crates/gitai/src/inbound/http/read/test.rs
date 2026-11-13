use axum::body::Body;
use axum::http::Request;
use serde_json::{Value, json};
use tower::ServiceExt;
use upstream_error::{UpstreamError, UpstreamFailure};

use super::*;
use crate::domain::read::ports::GithubError;
use crate::read_fakes::{ReadHarness, committed, note, session_event};

const DIRECT: &str = "1111111111111111111111111111111111111111";
const SESSION: &str = "s_aaaaaaaaaaaaaa";

async fn get(harness: &ReadHarness, uri: &str, key: Option<&str>) -> (StatusCode, Value) {
    let mut builder = Request::get(uri);
    if let Some(key) = key {
        builder = builder.header("x-api-key", key);
    }
    let response = read_router(harness.reader.clone())
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn commit_response_follows_the_contract() {
    let harness = ReadHarness::new().await;
    let note = note(
        "src/a.rs\n  s_aaaaaaaaaaaaaa::t_00000000000001 1-4\n",
        &[SESSION],
    );
    harness.upload(vec![committed(DIRECT, 4, 0, &note)]).await;

    let (status, body) = get(&harness, &format!("/v1/commits/{DIRECT}"), harness.key()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "repo": "github.com/macro-inc/macro",
            "sha": DIRECT,
            "pr": null,
            "resolved_via": "note",
            "commits": [DIRECT],
            "unattributed_commits": [],
            "ai_lines": 4,
            "human_lines": 0,
            "ai_share": 1.0,
            "tokens": { "input": 0, "output": 0, "cache_read": 0, "cache_write": 0 },
            "cost_usd": 0.0,
            "sessions": [{
                "id": SESSION,
                "tool": "claude",
                "model": "claude-sonnet-4-5",
                "author": "dev@example.com",
                "first_seen": null,
                "last_seen": null,
                "ai_lines": 4,
                "tokens": { "input": 0, "output": 0, "cache_read": 0, "cache_write": 0 },
                "cost_usd": 0.0,
                "url": "/gitai/v1/sessions/s_aaaaaaaaaaaaaa",
                "events_url": "/gitai/v1/sessions/s_aaaaaaaaaaaaaa/events",
            }],
        })
    );
}

#[tokio::test]
async fn read_routes_need_a_device_credential() {
    let harness = ReadHarness::new().await;

    for uri in [
        format!("/v1/commits/{DIRECT}"),
        "/v1/prs/macro-inc/macro/1".to_owned(),
        "/v1/blame?path=a.rs&start=1&end=2".to_owned(),
        format!("/v1/sessions/{SESSION}"),
        format!("/v1/sessions/{SESSION}/events"),
    ] {
        let (status, body) = get(&harness, &uri, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
        assert_eq!(body, json!({ "error": "unauthorized" }));
    }
}

#[tokio::test]
async fn unknown_things_are_404_and_bad_input_400() {
    let harness = ReadHarness::new().await;

    let (unknown, body) = get(&harness, &format!("/v1/commits/{DIRECT}"), harness.key()).await;
    let (bad_sha, _) = get(&harness, "/v1/commits/not-a-sha", harness.key()).await;
    let (bad_lines, _) = get(&harness, "/v1/blame?path=a.rs&start=5&end=1", harness.key()).await;

    assert_eq!(unknown, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "not_found" }));
    assert_eq!(bad_sha, StatusCode::BAD_REQUEST);
    assert_eq!(bad_lines, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn github_rate_limits_are_503_with_a_code() {
    let harness = ReadHarness::new().await;
    harness.github.script.lock().unwrap().failure = Some(GithubError::Upstream(UpstreamError {
        service: "GitHub",
        failure: UpstreamFailure::RateLimited { retry_after: None },
    }));

    let (status, body) = get(&harness, "/v1/prs/macro-inc/macro/42", harness.key()).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["code"], "upstream_rate_limited");
}

#[tokio::test]
async fn blame_without_a_github_token_is_501() {
    let harness = ReadHarness::new().await;
    harness.github.script.lock().unwrap().failure = Some(GithubError::BlameNeedsToken);

    let (status, body) = get(&harness, "/v1/blame?path=a.rs&start=1&end=2", harness.key()).await;

    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(body, json!({ "error": "blame_needs_github_token" }));
}

#[tokio::test]
async fn events_page_through_the_cursor() {
    let harness = ReadHarness::new().await;
    harness
        .upload(vec![
            session_event(SESSION, 1_794_543_002, 2),
            session_event(SESSION, 1_794_543_001, 1),
        ])
        .await;

    let uri = format!("/v1/sessions/{SESSION}/events?limit=1");
    let (_, first) = get(&harness, &uri, harness.key()).await;
    let next = first["next"].as_str().unwrap();
    let (_, second) = get(&harness, &format!("{uri}&from={next}"), harness.key()).await;

    assert_eq!(first["events"], json!([{ "type": "user", "n": 1 }]));
    assert_eq!(second["events"], json!([{ "type": "user", "n": 2 }]));
    assert_eq!(second["next"], Value::Null);
}
