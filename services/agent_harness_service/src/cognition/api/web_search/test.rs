use super::*;
use crate::cognition::api::context::test::{
    ADMISSION_TEST_USER, TestAdmission, admission_errors, authorized_request, test_api_context,
};
use axum::{Router, routing::post};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;

/// An Anthropic API stand-in that answers one request with `body`.
async fn anthropic_answering(body: Value) -> AnthropicToolContext {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let body = body.to_string();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut data = vec![0; 8192];
        assert!(socket.read(&mut data).await.unwrap() > 0);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    AnthropicToolContext::new(
        anthropic::client::Client::with_config(anthropic::config::Config {
            api_base: format!("http://{address}"),
            ..Default::default()
        }),
        "claude-haiku-4-5".into(),
    )
}

fn admitting() -> Arc<TestAdmission> {
    Arc::new(TestAdmission {
        result: Ok(()),
        calls: Default::default(),
    })
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_returns_found_pages_up_to_the_limit_charged_to_the_caller(pool: sqlx::PgPool) {
    let mut state = (*test_api_context(pool).await).clone();
    let admission = admitting();
    state.ai_admission = admission.clone();
    state.tool_service_context.anthropic_tool_context = anthropic_answering(json!({
        "id": "msg-1",
        "type": "message",
        "role": "assistant",
        "content": [
            {"type": "server_tool_use", "id": "srv-1", "name": "web_search", "input": {"query": "tokio"}},
            {
                "type": "web_search_tool_result",
                "tool_use_id": "srv-1",
                "content": [
                    {"type": "web_search_result", "url": "https://tokio.rs", "title": "Tokio", "encrypted_content": "abc", "page_age": "May 1, 2026"},
                    {"type": "web_search_result", "url": "https://docs.rs/tokio", "title": "tokio - Rust", "encrypted_content": "def"},
                ]
            },
        ],
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {"input_tokens": 10, "output_tokens": 5}
    }))
    .await;
    let router = Router::new()
        .route("/web/search", post(search_web_handler))
        .with_state(state);

    let response = router
        .oneshot(authorized_request(
            "/web/search",
            json!({"query": "tokio", "domains": ["tokio.rs"], "maxResults": 1}),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap(),
        json!({"results": [{"title": "Tokio", "url": "https://tokio.rs", "pageAge": "May 1, 2026"}]})
    );
    assert_eq!(
        *admission.calls.lock().unwrap(),
        [(ADMISSION_TEST_USER.into(), AiFeature::DynamicCompletionsApi)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn provider_rate_limits_answer_429(pool: sqlx::PgPool) {
    let mut state = (*test_api_context(pool).await).clone();
    state.ai_admission = admitting();
    state.tool_service_context.anthropic_tool_context = anthropic_answering(json!({
        "id": "msg-1",
        "type": "message",
        "role": "assistant",
        "content": [
            {"type": "server_tool_use", "id": "srv-1", "name": "web_search", "input": {"query": "tokio"}},
            {
                "type": "web_search_tool_result",
                "tool_use_id": "srv-1",
                "content": {"type": "web_search_tool_result_error", "error_code": "too_many_requests"}
            },
        ],
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {"input_tokens": 10, "output_tokens": 5}
    }))
    .await;
    let router = Router::new()
        .route("/web/search", post(search_web_handler))
        .with_state(state);

    let response = router
        .oneshot(authorized_request("/web/search", json!({"query": "tokio"})))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap()["code"],
        "web_search_rate_limited"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_errors_use_the_shared_status_and_machine_code(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool).await;
    for error in admission_errors() {
        let mut state = (*ctx).clone();
        state.ai_admission = TestAdmission::rejecting(error);
        let router = Router::new()
            .route("/web/search", post(search_web_handler))
            .with_state(state);

        let response = router
            .oneshot(authorized_request("/web/search", json!({"query": "tokio"})))
            .await
            .unwrap();

        assert_eq!(response.status(), admission_status(error));
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!({"error": error.to_string(), "code": error.code()})
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn invalid_requests_are_refused_before_admission(pool: sqlx::PgPool) {
    let mut state = (*test_api_context(pool).await).clone();
    let admission = admitting();
    state.ai_admission = admission.clone();
    let router = Router::new()
        .route("/web/search", post(search_web_handler))
        .with_state(state);

    for invalid in [
        json!({"query": "  "}),
        json!({"query": "x".repeat(401)}),
        json!({"query": "tokio", "maxResults": 0}),
        json!({"query": "tokio", "maxResults": 31}),
        json!({"query": "tokio", "domains": vec!["a.com"; 21]}),
        json!({"query": "tokio", "owner": "macro|other@example.com"}),
    ] {
        let response = router
            .clone()
            .oneshot(authorized_request("/web/search", invalid.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{invalid}");
    }
    assert!(admission.calls.lock().unwrap().is_empty());
}
