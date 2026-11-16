use std::sync::Mutex;

use agent_session::{
    domain::{model::AgentSessionId, ports::AgentSessionRepo},
    testing::{InMemoryAgentSessionRepo, test_agent_session},
};
use ai_billing::DisabledAiAdmissionService;
use ai_usage::{UsageAmount, UsageEvent};
use axum::{body::to_bytes, http::Request as HttpRequest};
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
    async fn computer_for(&self, _bot: BotId) -> sqlx::Result<Option<ComputerId>> {
        Ok(self.0)
    }
}

/// Hands each usage event to the test as it is recorded.
struct UsageEvents(tokio::sync::mpsc::UnboundedSender<UsageEvent>);

impl UsageRecorder for UsageEvents {
    fn record(&self, event: UsageEvent) {
        self.0.send(event).unwrap();
    }
}

/// An upstream whose one streamed response is fed by the test.
async fn fed_anthropic(body: tokio::sync::mpsc::Receiver<axum::body::Bytes>) -> String {
    let body = Arc::new(Mutex::new(Some(body)));
    let app = Router::new().fallback(move || {
        let mut receiver = body.lock().unwrap().take().unwrap();
        async move {
            let chunks = futures::stream::poll_fn(move |context| receiver.poll_recv(context))
                .map(Ok::<_, std::io::Error>);
            let mut response = Response::new(Body::from_stream(chunks));
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/event-stream"),
            );
            response
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{address}")
}

#[tokio::test]
async fn a_caller_that_hangs_up_mid_stream_is_still_billed_for_the_whole_response() {
    let (feed, body) = tokio::sync::mpsc::channel(4);
    let upstream_url = fed_anthropic(body).await;
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("session-secret").hash())
        .await
        .unwrap();
    let (recorded, mut events) = tokio::sync::mpsc::unbounded_channel();
    let app = router(
        GatewayState::new(
            Arc::new(repo),
            FixedComputer(Some(COMPUTER)),
            Arc::new(DisabledAiAdmissionService),
            Arc::new(UsageEvents(recorded)),
            &upstream_url,
            "upstream-key",
        )
        .unwrap(),
    );

    let (start, rest) =
        UPSTREAM_SSE.split_at(UPSTREAM_SSE.find("event: content_block_delta").unwrap());
    feed.send(axum::body::Bytes::from_static(start.as_bytes()))
        .await
        .unwrap();
    let response = app
        .oneshot(
            HttpRequest::post("/anthropic/v1/messages")
                .header("authorization", "Bearer session-secret")
                .body(Body::from(
                    r#"{"model":"claude-sonnet-5","max_tokens":1024,"stream":true,"messages":[]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let mut caller = response.into_body().into_data_stream();
    assert!(caller.next().await.unwrap().is_ok());
    drop(caller);

    feed.send(axum::body::Bytes::from_static(rest.as_bytes()))
        .await
        .unwrap();
    drop(feed);

    let event = events.recv().await.unwrap();
    assert_eq!(
        event.amount,
        UsageAmount::Tokens {
            input: 25,
            output: 15,
            cache_read: 4000,
            cache_write: 100,
        }
    );
}

async fn gateway(upstream_url: &str) -> (Router, AgentSession, Arc<RecordingUsage>) {
    gateway_with(upstream_url, Some(COMPUTER)).await
}

/// A gateway whose one session's bot runs on `computer`.
async fn gateway_with(
    upstream_url: &str,
    computer: Option<ComputerId>,
) -> (Router, AgentSession, Arc<RecordingUsage>) {
    let repo = InMemoryAgentSessionRepo::new();
    let mut session = test_agent_session(AgentSessionId::new());
    session.harness = "macrod".into();
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("session-secret").hash())
        .await
        .unwrap();
    let usage = Arc::new(RecordingUsage::default());
    let state = GatewayState::new(
        Arc::new(repo),
        FixedComputer(computer),
        Arc::new(DisabledAiAdmissionService),
        usage.clone(),
        upstream_url,
        "upstream-key",
    )
    .unwrap();
    (router(state), session, usage)
}

/// The rollout gates selling computers, not using them: a teammate outside it,
/// or anyone once it is off, still runs Claude on a team computer.
#[tokio::test]
async fn a_flag_off_teammate_on_a_team_computer_is_forwarded() {
    let (upstream_url, seen) = fake_anthropic().await;
    // Nothing about the rollout is consulted.
    let (app, _session, _usage) = gateway_with(&upstream_url, Some(COMPUTER)).await;

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

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_session_off_a_macro_computer_is_refused_before_anthropic_is_called() {
    let (upstream_url, seen) = fake_anthropic().await;
    let (app, _session, usage) = gateway_with(&upstream_url, None).await;

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
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["error"]["type"], "permission_error");
    assert!(seen.lock().unwrap().is_empty());
    assert!(usage.0.lock().unwrap().is_empty());
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

mod brain_route {
    use super::*;
    use crate::anthropic_gateway::brain::{
        BrainAuthenticator, BrainCaller, BrainLookup, BrainRollout,
    };
    use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

    const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
    const CREATOR: &str = "macro|admin@macro.com";
    const TEAM: uuid::Uuid = uuid::Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);

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

    /// Agent teammates on or off for [`CREATOR`], who invited [`AGENT`], and
    /// the other way round for the agent's own account.
    fn rollout_for_creator(on: bool) -> BrainRollout {
        let agent = MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned();
        let creator = MacroUserIdStr::parse_from_str(CREATOR)
            .unwrap()
            .into_owned();
        let mut creators = agent_credentials::FakeAgentCreators::default();
        creators.set(agent.clone(), creator.clone());
        let mut flags = FakeFeatureFlags::default();
        flags.set(
            creator,
            Ok(FlagSnapshot::new([(
                agent_credentials::AGENT_TEAMMATES_FLAG.into(),
                FlagValue::Boolean(on),
            )])),
        );
        flags.set(
            agent,
            Ok(FlagSnapshot::new([(
                agent_credentials::AGENT_TEAMMATES_FLAG.into(),
                FlagValue::Boolean(!on),
            )])),
        );
        BrainRollout::new(creators, flags)
    }

    async fn brain_gateway(
        upstream_url: &str,
        brains: Option<Arc<dyn BrainAuthenticator>>,
    ) -> (Router, Arc<RecordingUsage>) {
        brain_gateway_with(upstream_url, brains, rollout_for_creator(true)).await
    }

    async fn brain_gateway_with(
        upstream_url: &str,
        brains: Option<Arc<dyn BrainAuthenticator>>,
        rollout: BrainRollout,
    ) -> (Router, Arc<RecordingUsage>) {
        let usage = Arc::new(RecordingUsage::default());
        let mut state = GatewayState::new(
            Arc::new(InMemoryAgentSessionRepo::new()),
            FixedComputer(None),
            Arc::new(DisabledAiAdmissionService),
            usage.clone(),
            upstream_url,
            "upstream-key",
        )
        .unwrap();
        if let Some(brains) = brains {
            state = state.with_brains(brains, rollout);
        }
        (router(state), usage)
    }

    fn brain_request(key: &str) -> HttpRequest<Body> {
        HttpRequest::post("/brain/anthropic/v1/messages")
            .header("authorization", format!("Bearer {key}"))
            .header("anthropic-version", "2023-06-01")
            .body(Body::from(
                r#"{"model":"claude-haiku-4-5-20251001","max_tokens":16,"messages":[]}"#,
            ))
            .unwrap()
    }

    #[tokio::test]
    async fn an_agents_brain_calls_with_its_key_and_its_usage_counts_against_the_agent() {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, usage) = brain_gateway(&upstream_url, Some(Arc::new(OneAgent))).await;

        let response = app.oneshot(brain_request("mak_agent")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].path, "/v1/messages");
        assert_eq!(seen[0].headers["x-api-key"], "upstream-key");
        assert!(seen[0].headers.get("authorization").is_none());
        let events = usage.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].user.as_ref(), AGENT);
        assert_eq!(events[0].entity, None);
    }

    #[tokio::test]
    async fn with_agent_teammates_off_for_its_creator_an_agents_brain_is_refused() {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, usage) = brain_gateway_with(
            &upstream_url,
            Some(Arc::new(OneAgent)),
            rollout_for_creator(false),
        )
        .await;

        let response = app.oneshot(brain_request("mak_agent")).await.unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(seen.lock().unwrap().is_empty());
        assert!(usage.0.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn without_a_flag_provider_the_brain_is_refused() {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, _) = brain_gateway_with(
            &upstream_url,
            Some(Arc::new(OneAgent)),
            BrainRollout::default(),
        )
        .await;

        let response = app.oneshot(brain_request("mak_agent")).await.unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_key_that_is_not_an_agents_is_refused() {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, _) = brain_gateway(&upstream_url, Some(Arc::new(OneAgent))).await;

        let response = app
            .oneshot(brain_request("mak_someone_else"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn without_brains_configured_the_brain_route_is_unavailable() {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, _) = brain_gateway(&upstream_url, None).await;

        let response = app.oneshot(brain_request("mak_agent")).await.unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_session_token_does_not_open_the_brain_route() {
        let (upstream_url, seen) = fake_anthropic().await;
        let (app, _session, _) = gateway(&upstream_url).await;

        let response = app.oneshot(brain_request("session-secret")).await.unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(seen.lock().unwrap().is_empty());
    }
}
