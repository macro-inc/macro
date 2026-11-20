use std::sync::Mutex;

use ai_billing::DisabledAiAdmissionService;
use ai_usage::{UsageAmount, UsageEvent};
use axum::{extract::Request, http::Request as HttpRequest};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::json;
use tower::ServiceExt;

use super::*;
use crate::anthropic_gateway::brain::{BrainAuthenticator, BrainCaller, BrainLookup, BrainRollout};

const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const CREATOR: &str = "macro|admin@macro.com";
const TEAM: uuid::Uuid = uuid::Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);

const UPSTREAM_JSON: &str = r#"{"id":"cmpl-json","object":"chat.completion","model":"accounts/fireworks/models/kimi-k3","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":7,"total_tokens":127,"prompt_tokens_details":{"cached_tokens":100}}}"#;

const UPSTREAM_SSE: &str = "data: {\"id\":\"cmpl-sse\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}],\"usage\":null}\n\
\n\
data: {\"id\":\"cmpl-sse\",\"choices\":[],\"usage\":{\"prompt_tokens\":50,\"completion_tokens\":9,\"total_tokens\":59}}\n\
\n\
data: [DONE]\n\
\n";

/// Knows exactly one agent key.
struct OneAgent;

impl BrainAuthenticator for OneAgent {
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a> {
        Box::pin(async move {
            Ok((key == "mak_agent").then(|| BrainCaller {
                user_id: MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned(),
                team_id: TEAM,
            }))
        })
    }
}

fn rollout(on: bool) -> BrainRollout {
    let agent = MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned();
    let creator = MacroUserIdStr::parse_from_str(CREATOR)
        .unwrap()
        .into_owned();
    let mut creators = agent_credentials::FakeAgentCreators::default();
    creators.set(agent, creator.clone());
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        creator,
        Ok(FlagSnapshot::new([(
            agent_credentials::AGENT_TEAMMATES_FLAG.into(),
            FlagValue::Boolean(on),
        )])),
    );
    BrainRollout::new(creators, flags)
}

/// Hands each usage event to the test as it is recorded.
struct UsageEvents(tokio::sync::mpsc::UnboundedSender<UsageEvent>);

impl UsageRecorder for UsageEvents {
    fn record(&self, event: UsageEvent) {
        self.0.send(event).unwrap();
    }
}

/// What the fake Fireworks saw of one request.
#[derive(Debug, Clone)]
struct SeenRequest {
    path: String,
    authorization: Option<String>,
    body: Value,
}

/// Answers a streaming request with [`UPSTREAM_SSE`] in small pieces and any
/// other with [`UPSTREAM_JSON`], recording each request.
async fn fake_fireworks() -> (String, Arc<Mutex<Vec<SeenRequest>>>) {
    let seen = Arc::new(Mutex::new(Vec::<SeenRequest>::new()));
    let recorded = seen.clone();
    let app = Router::new().fallback(move |request: Request| {
        let recorded = recorded.clone();
        async move {
            let (parts, body) = request.into_parts();
            let body: Value =
                serde_json::from_slice(&axum::body::to_bytes(body, usize::MAX).await.unwrap())
                    .unwrap();
            let streaming = body["stream"] == true;
            recorded.lock().unwrap().push(SeenRequest {
                path: parts.uri.path().to_owned(),
                authorization: parts
                    .headers
                    .get("authorization")
                    .map(|value| value.to_str().unwrap().to_owned()),
                body,
            });

            let (content_type, body) = if streaming {
                let pieces: Vec<Result<Bytes, std::io::Error>> = UPSTREAM_SSE
                    .as_bytes()
                    .chunks(23)
                    .map(|piece| Ok(Bytes::copy_from_slice(piece)))
                    .collect();
                (
                    "text/event-stream",
                    Body::from_stream(futures::stream::iter(pieces)),
                )
            } else {
                ("application/json", Body::from(UPSTREAM_JSON))
            };
            let mut response = Response::new(body);
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
            response.headers_mut().insert(
                "x-fireworks-account",
                HeaderValue::from_static("acct-secret"),
            );
            response
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), seen)
}

fn gateway(
    upstream_url: &str,
    teammates_on: bool,
) -> (Router, tokio::sync::mpsc::UnboundedReceiver<UsageEvent>) {
    let (events, received) = tokio::sync::mpsc::unbounded_channel();
    let gateway = FireworksGateway::new(
        BrainAccess {
            brains: Arc::new(OneAgent),
            rollout: rollout(teammates_on),
            admission: Arc::new(DisabledAiAdmissionService),
        },
        Arc::new(UsageEvents(events)),
        upstream_url,
        "firework-key",
    )
    .unwrap();
    (router(gateway), received)
}

fn chat_request(key: &str, body: Value) -> HttpRequest<Body> {
    HttpRequest::post("/brain/fireworks/v1/chat/completions")
        .header("authorization", format!("Bearer {key}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn a_completion_is_forwarded_with_macros_key_a_default_cap_and_billed_to_the_agent() {
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, mut usage) = gateway(&upstream_url, true);

    let response = app
        .oneshot(chat_request(
            "mak_agent",
            json!({ "model": KIMI_K3, "messages": [{ "role": "user", "content": "hi" }] }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().get("x-fireworks-account").is_none());
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body, UPSTREAM_JSON.as_bytes());
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].path, "/v1/chat/completions");
    assert_eq!(
        seen[0].authorization.as_deref(),
        Some("Bearer firework-key")
    );
    assert_eq!(
        seen[0].body,
        json!({
            "model": KIMI_K3,
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 4096,
        })
    );
    let event = usage.recv().await.unwrap();
    assert_eq!(event.user.as_ref(), AGENT);
    assert_eq!(event.feature, AiFeature::AgentSession);
    assert_eq!(event.model, "kimi-k3");
    assert_eq!(
        event.amount,
        UsageAmount::Tokens {
            input: 20,
            output: 7,
            cache_read: 100,
            cache_write: 0,
        }
    );
}

#[tokio::test]
async fn a_stream_is_capped_asked_for_its_usage_and_passed_through_unchanged() {
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, mut usage) = gateway(&upstream_url, true);

    let response = app
        .oneshot(chat_request(
            "mak_agent",
            json!({
                "model": KIMI_K3,
                "messages": [],
                "stream": true,
                "stream_options": { "include_usage": false, "other": 1 },
                "max_tokens": 20000,
                "max_completion_tokens": 100,
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body, UPSTREAM_SSE.as_bytes());
    assert_eq!(
        seen.lock().unwrap()[0].body,
        json!({
            "model": KIMI_K3,
            "messages": [],
            "stream": true,
            "stream_options": { "include_usage": true, "other": 1 },
            "max_tokens": 8192,
            "max_completion_tokens": 100,
        })
    );
    let event = usage.recv().await.unwrap();
    assert_eq!(
        event.amount,
        UsageAmount::Tokens {
            input: 50,
            output: 9,
            cache_read: 0,
            cache_write: 0,
        }
    );
}

#[tokio::test]
async fn other_models_paths_and_callers_are_refused_before_fireworks() {
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, _) = gateway(&upstream_url, true);
    let (off, _) = gateway(&upstream_url, false);

    let other_model = app
        .clone()
        .oneshot(chat_request(
            "mak_agent",
            json!({ "model": "accounts/fireworks/models/deepseek-v4-pro", "messages": [] }),
        ))
        .await
        .unwrap();
    let other_path = app
        .clone()
        .oneshot(
            HttpRequest::post("/brain/fireworks/v1/completions")
                .header("authorization", "Bearer mak_agent")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    let unknown_key = app
        .oneshot(chat_request(
            "mak_nobody",
            json!({ "model": KIMI_K3, "messages": [] }),
        ))
        .await
        .unwrap();
    let teammates_off = off
        .oneshot(chat_request(
            "mak_agent",
            json!({ "model": KIMI_K3, "messages": [] }),
        ))
        .await
        .unwrap();

    assert_eq!(other_model.status(), StatusCode::BAD_REQUEST);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(other_model.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["error"]["type"], "invalid_request_error");
    assert_eq!(other_path.status(), StatusCode::NOT_FOUND);
    assert_eq!(unknown_key.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(teammates_off.status(), StatusCode::FORBIDDEN);
    assert!(seen.lock().unwrap().is_empty());
}
