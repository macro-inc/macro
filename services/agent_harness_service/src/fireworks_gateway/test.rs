use std::sync::Mutex;

use ai_billing::DisabledAiAdmissionService;
use ai_usage::financial::{FinalizeInvocation, ProviderOutcome, WriteDisposition};
use ai_usage::{FinancialFuture, TrackedInvocation, UsageAmount, UsageEvent, UsageTracking};
use axum::{extract::Request, http::Request as HttpRequest};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::json;
use sqlx::PgPool;
use tower::ServiceExt;

use super::*;
use crate::anthropic_gateway::brain::{BrainAuthenticator, BrainCaller, BrainLookup, BrainRollout};
use crate::solver_runs::pg::PgSolverRuns;
use crate::solver_runs::{RunLimits, RunStart};

use crate::solver_runs::test::AGENT;
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

/// Hands each usage event and each finalized observation to the test as
/// it is recorded.
struct UsageEvents {
    events: tokio::sync::mpsc::UnboundedSender<UsageEvent>,
    tracking: Arc<Observations>,
}

impl UsageRecorder for UsageEvents {
    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        Some(self.tracking.clone())
    }

    fn record(&self, event: UsageEvent) {
        self.events.send(event).unwrap();
    }
}

struct Observations {
    begins: Mutex<Vec<TrackedInvocation>>,
    finals: tokio::sync::mpsc::UnboundedSender<FinalizeInvocation>,
}

impl UsageTracking for Observations {
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        self.begins.lock().unwrap().push(request);
        Box::pin(async { Ok(WriteDisposition::Inserted) })
    }

    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        self.finals.send(evidence).unwrap();
        Box::pin(async { Ok(WriteDisposition::Inserted) })
    }
}

/// What the gateway recorded.
struct Recorded {
    usage: tokio::sync::mpsc::UnboundedReceiver<UsageEvent>,
    /// Each call's observation, finalized once its in-flight slot is back.
    finals: tokio::sync::mpsc::UnboundedReceiver<FinalizeInvocation>,
    tracking: Arc<Observations>,
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
    held_fireworks(None).await
}

/// Holds each answer of [`held_fireworks`] until a permit lets it through,
/// and says when a request has arrived.
#[derive(Clone)]
struct Gate {
    permits: Arc<tokio::sync::Semaphore>,
    arrived: tokio::sync::mpsc::UnboundedSender<()>,
}

/// [`fake_fireworks`], each answer held at `gate`.
async fn held_fireworks(gate: Option<Gate>) -> (String, Arc<Mutex<Vec<SeenRequest>>>) {
    let seen = Arc::new(Mutex::new(Vec::<SeenRequest>::new()));
    let recorded = seen.clone();
    let app = Router::new().fallback(move |request: Request| {
        let recorded = recorded.clone();
        let gate = gate.clone();
        async move {
            let (parts, body) = request.into_parts();
            let body: Value =
                serde_json::from_slice(&axum::body::to_bytes(body, usize::MAX).await.unwrap())
                    .unwrap();
            let streaming = body["stream"] == true;
            if let Some(gate) = gate {
                gate.arrived.send(()).unwrap();
                gate.permits.acquire().await.unwrap().forget();
            }
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

fn access(teammates_on: bool) -> BrainAccess {
    BrainAccess {
        brains: Arc::new(OneAgent),
        rollout: rollout(teammates_on),
        admission: Arc::new(DisabledAiAdmissionService),
    }
}

fn gateway_with(
    pool: &PgPool,
    upstream_url: &str,
    teammates_on: bool,
    key: Option<&str>,
) -> (Router, Recorded) {
    let (events, usage) = tokio::sync::mpsc::unbounded_channel();
    let (finals_sender, finals) = tokio::sync::mpsc::unbounded_channel();
    let tracking = Arc::new(Observations {
        begins: Mutex::default(),
        finals: finals_sender,
    });
    let gateway = FireworksGateway::new(
        access(teammates_on),
        Arc::new(UsageEvents {
            events,
            tracking: tracking.clone(),
        }),
        Arc::new(PgSolverRuns::new(pool.clone(), RunLimits::default())),
        upstream_url,
        key,
        tokio_util::task::TaskTracker::new(),
    )
    .unwrap();
    (
        router(gateway),
        Recorded {
            usage,
            finals,
            tracking,
        },
    )
}

fn gateway(pool: &PgPool, upstream_url: &str, teammates_on: bool) -> (Router, Recorded) {
    gateway_with(pool, upstream_url, teammates_on, Some("firework-key"))
}

/// The agent exists and has a live run.
async fn run(pool: &PgPool) -> String {
    crate::solver_runs::test::insert_agent(pool, AGENT)
        .await
        .unwrap();
    let agent = MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned();
    match PgSolverRuns::new(pool.clone(), RunLimits::default())
        .start(&agent)
        .await
        .unwrap()
    {
        RunStart::Started { run_id, .. } => run_id.0.to_string(),
        refused => panic!("{refused:?}"),
    }
}

fn chat_request(key: &str, run: &str, body: Value) -> HttpRequest<Body> {
    HttpRequest::post("/brain/fireworks/v1/chat/completions")
        .header("authorization", format!("Bearer {key}"))
        .header("content-type", "application/json")
        .header("x-macro-solver-run", run)
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn error_of(response: Response) -> Value {
    serde_json::from_slice::<Value>(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap()["error"]
        .clone()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_completion_is_forwarded_with_macros_key_a_default_cap_and_billed_to_the_agent(
    pool: PgPool,
) {
    let run = run(&pool).await;
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, mut recorded) = gateway(&pool, &upstream_url, true);

    let response = app
        .oneshot(chat_request(
            "mak_agent",
            &run,
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
            "max_tokens": 2048,
        })
    );
    let event = recorded.usage.recv().await.unwrap();
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
    // Observed under the solver run, with Fireworks' id; billed only above.
    let observed = recorded.finals.recv().await.unwrap();
    assert_eq!(
        observed.provider_request_id.as_ref().map(|id| id.as_str()),
        Some("cmpl-json")
    );
    assert_eq!(observed.outcome, ProviderOutcome::Succeeded);
    // Begun before the call and again on delivery, as one invocation.
    let begun = recorded.tracking.begins.lock().unwrap().clone();
    assert!(begun.iter().all(|begin| *begin == begun[0]), "{begun:?}");
    assert_eq!(begun[0].invocation_id, observed.invocation_id);
    assert_eq!(begun[0].run_id.as_uuid().to_string(), run);
    assert_eq!(begun[0].model.provider(), "fireworks");
    assert_eq!(begun[0].model.model(), KIMI_K3);
    assert_eq!(begun[0].user.as_ref(), AGENT);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stream_is_capped_asked_for_its_usage_and_passed_through_unchanged(pool: PgPool) {
    let run = run(&pool).await;
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, mut recorded) = gateway(&pool, &upstream_url, true);

    let response = app
        .oneshot(chat_request(
            "mak_agent",
            &run,
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
            "max_tokens": 2048,
            "max_completion_tokens": 100,
        })
    );
    let event = recorded.usage.recv().await.unwrap();
    assert_eq!(
        event.amount,
        UsageAmount::Tokens {
            input: 50,
            output: 9,
            cache_read: 0,
            cache_write: 0,
        }
    );
    let observed = recorded.finals.recv().await.unwrap();
    assert_eq!(
        observed.provider_request_id.as_ref().map(|id| id.as_str()),
        Some("cmpl-sse")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_null_output_cap_is_unset_and_gets_the_default(pool: PgPool) {
    let run = run(&pool).await;
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, _recorded) = gateway(&pool, &upstream_url, true);

    let both_null = app
        .clone()
        .oneshot(chat_request(
            "mak_agent",
            &run,
            json!({
                "model": KIMI_K3,
                "messages": [],
                "max_tokens": null,
                "max_completion_tokens": null,
            }),
        ))
        .await
        .unwrap();
    let one_null = app
        .oneshot(chat_request(
            "mak_agent",
            &run,
            json!({
                "model": KIMI_K3,
                "messages": [],
                "max_tokens": null,
                "max_completion_tokens": 20000,
            }),
        ))
        .await
        .unwrap();

    assert_eq!(both_null.status(), StatusCode::OK);
    assert_eq!(one_null.status(), StatusCode::OK);
    let seen = seen.lock().unwrap().clone();
    assert_eq!(
        seen[0].body,
        json!({ "model": KIMI_K3, "messages": [], "max_tokens": 2048 })
    );
    assert_eq!(
        seen[1].body,
        json!({ "model": KIMI_K3, "messages": [], "max_completion_tokens": 2048 })
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_models_paths_and_callers_are_refused_before_fireworks(pool: PgPool) {
    let run = run(&pool).await;
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, _) = gateway(&pool, &upstream_url, true);
    let (off, _) = gateway(&pool, &upstream_url, false);

    let other_model = app
        .clone()
        .oneshot(chat_request(
            "mak_agent",
            &run,
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
        .clone()
        .oneshot(chat_request(
            "mak_nobody",
            &run,
            json!({ "model": KIMI_K3, "messages": [] }),
        ))
        .await
        .unwrap();
    let many_choices = app
        .clone()
        .oneshot(chat_request(
            "mak_agent",
            &run,
            json!({ "model": KIMI_K3, "messages": [], "n": 64 }),
        ))
        .await
        .unwrap();
    let teammates_off = off
        .oneshot(chat_request(
            "mak_agent",
            &run,
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
    assert_eq!(many_choices.status(), StatusCode::BAD_REQUEST);
    assert_eq!(unknown_key.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(teammates_off.status(), StatusCode::FORBIDDEN);
    assert!(seen.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_call_needs_a_live_run_of_its_own(pool: PgPool) {
    let run = run(&pool).await;
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, _) = gateway(&pool, &upstream_url, true);
    let body = json!({ "model": KIMI_K3, "messages": [] });
    let mut without_run = chat_request("mak_agent", &run, body.clone());
    without_run.headers_mut().remove("x-macro-solver-run");

    let missing = app.clone().oneshot(without_run).await.unwrap();
    let unknown = app
        .clone()
        .oneshot(chat_request(
            "mak_agent",
            &uuid::Uuid::now_v7().to_string(),
            body.clone(),
        ))
        .await
        .unwrap();
    sqlx::query!("UPDATE agent_captcha_runs SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let expired = app
        .oneshot(chat_request("mak_agent", &run, body))
        .await
        .unwrap();

    assert_eq!(missing.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        error_of(missing).await,
        json!({
            "type": "permission_error",
            "code": "solver_run_required",
            "message": "start a solver run and send its runId as x-macro-solver-run",
        })
    );
    assert_eq!(unknown.status(), StatusCode::FORBIDDEN);
    assert_eq!(error_of(unknown).await["code"], "solver_run_required");
    assert_eq!(expired.status(), StatusCode::FORBIDDEN);
    assert_eq!(error_of(expired).await["code"], "solver_run_expired");
    assert!(seen.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_allows_sixteen_calls(pool: PgPool) {
    let run = run(&pool).await;
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, mut recorded) = gateway(&pool, &upstream_url, true);
    let body = json!({ "model": KIMI_K3, "messages": [] });

    for _ in 0..16 {
        let response = app
            .clone()
            .oneshot(chat_request("mak_agent", &run, body.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        // Its in-flight slot is back before it is observed.
        recorded.finals.recv().await.unwrap();
    }
    let seventeenth = app
        .oneshot(chat_request("mak_agent", &run, body))
        .await
        .unwrap();

    assert_eq!(seventeenth.status(), StatusCode::TOO_MANY_REQUESTS);
    let error = error_of(seventeenth).await;
    assert_eq!(error["type"], "rate_limit_error");
    assert_eq!(error["code"], "solver_run_exhausted");
    assert_eq!(seen.lock().unwrap().len(), 16);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_calls_of_a_run_may_run_at_once(pool: PgPool) {
    let run = run(&pool).await;
    let permits = Arc::new(tokio::sync::Semaphore::new(0));
    let (arrived, mut arrivals) = tokio::sync::mpsc::unbounded_channel();
    let (upstream_url, seen) = held_fireworks(Some(Gate {
        permits: permits.clone(),
        arrived,
    }))
    .await;
    let (app, mut recorded) = gateway(&pool, &upstream_url, true);
    let body = json!({ "model": KIMI_K3, "messages": [] });
    let call = |app: Router| {
        let request = chat_request("mak_agent", &run, body.clone());
        tokio::spawn(async move {
            let response = app.oneshot(request).await.unwrap();
            let status = response.status();
            axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            status
        })
    };

    let first = call(app.clone());
    let second = call(app.clone());
    // Both are held at Fireworks, so both took their slot.
    arrivals.recv().await.unwrap();
    arrivals.recv().await.unwrap();
    let third = app
        .clone()
        .oneshot(chat_request("mak_agent", &run, body.clone()))
        .await
        .unwrap();
    permits.add_permits(1);
    let finished = tokio::select! {
        status = first => status.unwrap(),
        status = second => status.unwrap(),
    };
    recorded.finals.recv().await.unwrap();
    let fourth = call(app.clone());
    permits.add_permits(2);
    let fourth = fourth.await.unwrap();

    assert_eq!(third.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(error_of(third).await["code"], "solver_run_busy");
    assert_eq!(finished, StatusCode::OK);
    assert_eq!(fourth, StatusCode::OK);
    assert_eq!(seen.lock().unwrap().len(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_a_key_every_call_is_not_configured(pool: PgPool) {
    let run = run(&pool).await;
    let (upstream_url, seen) = fake_fireworks().await;
    let (app, _) = gateway_with(&pool, &upstream_url, true, None);

    let response = app
        .oneshot(chat_request(
            "mak_agent",
            &run,
            json!({ "model": KIMI_K3, "messages": [] }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error_of(response).await["type"], "not_configured");
    assert!(seen.lock().unwrap().is_empty());
}
