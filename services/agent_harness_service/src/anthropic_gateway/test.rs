use std::sync::Mutex;

use agent_session::{
    domain::{model::AgentSessionId, ports::AgentSessionRepo},
    testing::{InMemoryAgentSessionRepo, test_agent_session},
};
use ai_billing::DisabledAiAdmissionService;
use ai_usage::{UsageAmount, UsageEvent};
use axum::{body::to_bytes, http::Request as HttpRequest};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use hosted_runtimes::domain::rollout::ENABLE_MACRO_COMPUTERS;
use tower::ServiceExt;

use super::*;

const UPSTREAM_SSE: &str = "event: message_start\n\
data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-5\",\"content\":[],\"usage\":{\"input_tokens\":25,\"cache_creation_input_tokens\":100,\"cache_read_input_tokens\":4000,\"output_tokens\":1}}}\n\
\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\
\n\
event: message_delta\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":15}}\n\
\n\
event: message_stop\n\
data: {\"type\":\"message_stop\"}\n\
\n";

const UPSTREAM_JSON: &str = r#"{"id":"msg_2","type":"message","role":"assistant","model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":9,"cache_creation_input_tokens":0,"cache_read_input_tokens":2,"output_tokens":5}}"#;

/// What the fake Anthropic saw of one request.
#[derive(Debug, Clone)]
struct SeenRequest {
    path: String,
    headers: HeaderMap,
    body: String,
}

#[derive(Default)]
struct RecordingUsage(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for RecordingUsage {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

/// Serves a canned SSE stream (split into several writes) for streaming
/// requests and a canned JSON message otherwise, recording each request.
async fn fake_anthropic() -> (String, Arc<Mutex<Vec<SeenRequest>>>) {
    let seen = Arc::new(Mutex::new(Vec::<SeenRequest>::new()));
    let recorded = seen.clone();
    let app = Router::new().fallback(move |request: Request| {
        let recorded = recorded.clone();
        async move {
            let (parts, body) = request.into_parts();
            let body =
                String::from_utf8(to_bytes(body, usize::MAX).await.unwrap().to_vec()).unwrap();
            let streaming = body.contains("\"stream\":true");
            recorded.lock().unwrap().push(SeenRequest {
                path: parts.uri.path().to_owned(),
                headers: parts.headers,
                body,
            });

            let mut response = if streaming {
                let pieces: Vec<Result<axum::body::Bytes, std::io::Error>> = UPSTREAM_SSE
                    .as_bytes()
                    .chunks(37)
                    .map(|piece| Ok(axum::body::Bytes::copy_from_slice(piece)))
                    .collect();
                let mut response = Response::new(Body::from_stream(futures::stream::iter(pieces)));
                response.headers_mut().insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/event-stream; charset=utf-8"),
                );
                response
            } else {
                let mut response = Response::new(Body::from(UPSTREAM_JSON));
                response.headers_mut().insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                );
                response
            };
            response
                .headers_mut()
                .insert("request-id", HeaderValue::from_static("req_upstream_1"));
            response.headers_mut().insert(
                "anthropic-organization-id",
                HeaderValue::from_static("org-secret"),
            );
            response
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), seen)
}

/// The computer the fake directory says serves every bot.
const COMPUTER: ComputerId =
    ComputerId::new_from_uuid(uuid::uuid!("0198f1a4-7b1c-7000-8000-000000000001"));

/// Answers every bot with the same computer, or none.
struct FixedComputer(Option<ComputerId>);

impl BotComputers for FixedComputer {
    fn computer_for(
        &self,
        _bot: BotId,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Option<ComputerId>>> + Send + '_>> {
        let computer = self.0;
        Box::pin(async move { Ok(computer) })
    }
}

/// Whether the session runs on a Macro computer, and whether its owner has the rollout.
#[derive(Clone, Copy)]
struct Access {
    computer: Option<ComputerId>,
    rollout: bool,
}

const COMPUTER_SESSION: Access = Access {
    computer: Some(COMPUTER),
    rollout: true,
};

async fn gateway(upstream_url: &str) -> (Router, AgentSession, Arc<RecordingUsage>) {
    gateway_with(upstream_url, COMPUTER_SESSION).await
}

async fn gateway_with(
    upstream_url: &str,
    access: Access,
) -> (Router, AgentSession, Arc<RecordingUsage>) {
    let repo = InMemoryAgentSessionRepo::new();
    let mut session = test_agent_session(AgentSessionId::new());
    session.harness = "macrod".into();
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("session-secret").hash())
        .await
        .unwrap();
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        session.owner_user().unwrap().clone(),
        Ok(FlagSnapshot::new([(
            ENABLE_MACRO_COMPUTERS.into(),
            FlagValue::Boolean(access.rollout),
        )])),
    );
    let usage = Arc::new(RecordingUsage::default());
    let state = GatewayState::new(
        Arc::new(repo),
        Arc::new(FixedComputer(access.computer)),
        ComputerRollout::new(flags),
        Arc::new(DisabledAiAdmissionService),
        usage.clone(),
        upstream_url,
        "upstream-key",
    )
    .unwrap();
    (router(state), session, usage)
}

#[tokio::test]
async fn a_session_off_a_macro_computer_is_refused_before_anthropic_is_called() {
    for access in [
        Access {
            computer: None,
            rollout: true,
        },
        Access {
            computer: Some(COMPUTER),
            rollout: false,
        },
    ] {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, _session, usage) = gateway_with(&upstream_url, access).await;

        let response = app
            .oneshot(
                HttpRequest::post("/anthropic/v1/messages")
                    .header("authorization", "Bearer session-secret")
                    .body(Body::from(
                        r#"{"model":"claude-sonnet-5","max_tokens":16,"messages":[]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["error"]["type"], "permission_error");
        assert!(seen.lock().unwrap().is_empty());
        assert!(usage.0.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn streams_messages_through_with_our_key_and_records_usage() {
    let (upstream_url, seen) = fake_anthropic().await;
    let (app, session, usage) = gateway(&upstream_url).await;
    let request_body = r#"{"model":"claude-sonnet-5","max_tokens":1024,"stream":true,"messages":[{"role":"user","content":"hi"}]}"#;

    let response = app
        .oneshot(
            HttpRequest::post("/anthropic/v1/messages")
                .header("authorization", "Bearer session-secret")
                .header("x-api-key", "caller-key")
                .header("cookie", "session=caller")
                .header("anthropic-version", "2023-06-01")
                .header("anthropic-beta", "claude-code-20250219")
                .header("anthropic-beta", "interleaved-thinking-2025-05-14")
                .header("content-type", "application/json")
                .body(Body::from(request_body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"],
        "text/event-stream; charset=utf-8"
    );
    assert_eq!(response.headers()["request-id"], "req_upstream_1");
    assert!(
        response
            .headers()
            .get("anthropic-organization-id")
            .is_none()
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(std::str::from_utf8(&body).unwrap(), UPSTREAM_SSE);

    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].path, "/v1/messages");
    assert_eq!(seen[0].body, request_body);
    assert_eq!(seen[0].headers["x-api-key"], "upstream-key");
    assert_eq!(seen[0].headers["anthropic-version"], "2023-06-01");
    let betas: Vec<&str> = seen[0]
        .headers
        .get_all("anthropic-beta")
        .iter()
        .map(|value| value.to_str().unwrap())
        .collect();
    assert_eq!(
        betas,
        ["claude-code-20250219", "interleaved-thinking-2025-05-14"]
    );
    assert!(seen[0].headers.get("authorization").is_none());
    assert!(seen[0].headers.get("cookie").is_none());

    let events = usage.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].feature, AiFeature::AgentSession);
    assert_eq!(&events[0].user, session.owner_user().unwrap());
    assert_eq!(events[0].entity, Some(session.id.as_uuid()));
    assert_eq!(events[0].model, "claude-sonnet-5");
    assert_eq!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 25,
            output: 15,
            cache_read: 4000,
            cache_write: 100,
        }
    );
}

#[tokio::test]
async fn non_streaming_messages_record_usage_under_the_priced_model() {
    let (upstream_url, _seen) = fake_anthropic().await;
    let (app, _session, usage) = gateway(&upstream_url).await;

    let response = app
        .oneshot(
            HttpRequest::post("/anthropic/v1/messages")
                .header("authorization", "Bearer session-secret")
                .header("anthropic-version", "2023-06-01")
                .body(Body::from(
                    r#"{"model":"claude-haiku-4-5-20251001","max_tokens":16,"messages":[]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(std::str::from_utf8(&body).unwrap(), UPSTREAM_JSON);
    let events = usage.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].model, "claude-haiku-4-5");
    assert_eq!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 9,
            output: 5,
            cache_read: 2,
            cache_write: 0,
        }
    );
}

#[tokio::test]
async fn count_tokens_is_forwarded_without_recording_usage() {
    let (upstream_url, seen) = fake_anthropic().await;
    let (app, _session, usage) = gateway(&upstream_url).await;

    let response = app
        .oneshot(
            HttpRequest::post("/anthropic/v1/messages/count_tokens")
                .header("authorization", "Bearer session-secret")
                .body(Body::from(r#"{"model":"claude-opus-5-5","messages":[]}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(seen.lock().unwrap()[0].path, "/v1/messages/count_tokens");
    assert!(usage.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_model_off_the_allowlist_is_refused_before_anthropic_is_called() {
    let (upstream_url, seen) = fake_anthropic().await;
    let (app, _session, usage) = gateway(&upstream_url).await;

    let response = app
        .oneshot(
            HttpRequest::post("/anthropic/v1/messages")
                .header("authorization", "Bearer session-secret")
                .body(Body::from(
                    r#"{"model":"claude-3-opus-20240229","max_tokens":16,"messages":[]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "type": "error",
            "error": {
                "type": "invalid_request_error",
                "message": "model `claude-3-opus-20240229` is not available on Macro credits; use one of: claude-opus-4-8, claude-sonnet-4-6, claude-opus-5-5, claude-sonnet-5, claude-haiku-4-5-20251001, claude-fable-5-1",
            },
        })
    );
    assert!(seen.lock().unwrap().is_empty());
    assert!(usage.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unknown_token_is_refused() {
    let (upstream_url, seen) = fake_anthropic().await;
    let (app, _session, _usage) = gateway(&upstream_url).await;

    let response = app
        .oneshot(
            HttpRequest::post("/anthropic/v1/messages")
                .header("authorization", "Bearer not-a-session")
                .body(Body::from(r#"{"model":"claude-sonnet-5","messages":[]}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["error"]["type"], "authentication_error");
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn bundled_claude_models_reach_upstream_and_keep_their_billing_model() {
    for model in ["claude-opus-4-8", "claude-sonnet-4-6"] {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, _, usage) = gateway(&upstream_url).await;
        let body = serde_json::json!({"model": model, "max_tokens": 16, "messages": [{"role": "user", "content": "hi"}]}).to_string();
        let response = app
            .oneshot(
                HttpRequest::post("/anthropic/v1/messages")
                    .header("authorization", "Bearer session-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let requests = seen.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].body, body);
        let events = usage.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].model, model);
    }
}
