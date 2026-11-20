use std::sync::Mutex;

use ai_billing::DisabledAiAdmissionService;
use ai_usage::{AiFeature, UsageAmount, UsageEvent, UsageRecorder};
use axum::{body::Body, http::Request};
use capsolver_emulator::{CapsolverEmulator, Outcome};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::{Value, json};
use tower::ServiceExt;

use super::solves::{Created, Polled, SolverError, TaskId};
use super::*;
use crate::anthropic_gateway::brain::{BrainAuthenticator, BrainCaller, BrainLookup, BrainRollout};

const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const OTHER_AGENT: &str = "macro|kai-lopez-def456@agents.macro.invalid";
const CREATOR: &str = "macro|admin@macro.com";
const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);
const SOLVE: Uuid = Uuid::from_u128(0x0193_a1b2_0000_4000_8000_0000_0000_0001);

/// `mak_agent` is [`AGENT`], `mak_other` is [`OTHER_AGENT`].
struct TwoAgents;

impl BrainAuthenticator for TwoAgents {
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a> {
        Box::pin(async move {
            let agent = match key {
                "mak_agent" => AGENT,
                "mak_other" => OTHER_AGENT,
                _ => return Ok(None),
            };
            Ok(Some(BrainCaller {
                user_id: MacroUserIdStr::parse_from_str(agent).unwrap().into_owned(),
                team_id: TEAM,
            }))
        })
    }
}

/// Agent teammates on or off for [`CREATOR`], who invited both agents.
fn rollout(on: bool) -> BrainRollout {
    let creator = MacroUserIdStr::parse_from_str(CREATOR)
        .unwrap()
        .into_owned();
    let mut creators = agent_credentials::FakeAgentCreators::default();
    for agent in [AGENT, OTHER_AGENT] {
        creators.set(
            MacroUserIdStr::parse_from_str(agent).unwrap().into_owned(),
            creator.clone(),
        );
    }
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

#[derive(Default)]
struct RecordingUsage(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for RecordingUsage {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn access(on: bool) -> BrainAccess {
    BrainAccess {
        brains: Arc::new(TwoAgents),
        rollout: rollout(on),
        admission: Arc::new(DisabledAiAdmissionService),
    }
}

/// Polls every 10 ms and gives up after a second.
const FAST: SolveLimits = SolveLimits {
    concurrent: 1,
    hourly: 20,
    daily: 100,
    poll_interval: Duration::from_millis(10),
    max_wait: Duration::from_secs(1),
};

fn gateway_on(emulator: &CapsolverEmulator, limits: SolveLimits) -> (Router, Arc<RecordingUsage>) {
    let usage = Arc::new(RecordingUsage::default());
    let solver = Capsolver::new("capsolver-key", &emulator.base_url()).unwrap();
    let gateway = CaptchaGateway::new(access(true), Some(solver), usage.clone(), limits);
    (router(gateway), usage)
}

fn solve_request(key: &str, body: Value) -> Request<Body> {
    Request::post("/brain/captcha/solve")
        .header("authorization", format!("Bearer {key}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn answer(app: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn a_recaptcha_v2_is_solved_from_its_page_without_query_and_billed_once() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    let (app, usage) = gateway_on(&emulator, FAST);

    let (status, body) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": SOLVE,
                "challenge": {
                    "kind": "recaptchaV2",
                    "pageUrl": "https://user:pass@shop.example.com/checkout?cart=42#pay",
                    "siteKey": "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
                    "invisible": true,
                    "dataS": "s-value",
                    "action": "checkout",
                },
            }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let tasks = emulator.created_tasks();
    assert_eq!(tasks.len(), 1);
    let task_id = tasks[0].task_id.clone().unwrap();
    assert_eq!(
        body,
        json!({
            "outcome": "solved",
            "token": format!("emulated-token-{task_id}"),
            "userAgent": "Mozilla/5.0 (X11; Linux x86_64) CapsolverEmulator/1.0",
            "taskId": task_id,
        })
    );
    assert_eq!(tasks[0].client_key, "capsolver-key");
    assert_eq!(
        tasks[0].task,
        json!({
            "type": "ReCaptchaV2TaskProxyLess",
            "websiteURL": "https://shop.example.com/checkout",
            "websiteKey": "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
            "isInvisible": true,
            "pageAction": "checkout",
            "recaptchaDataSValue": "s-value",
        })
    );
    let events = usage.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].user.as_ref(), AGENT);
    assert_eq!(events[0].feature, AiFeature::AgentSession);
    assert_eq!(events[0].model, "capsolver-recaptcha-v2");
    assert_eq!(
        events[0].amount,
        UsageAmount::ProviderCredits { credits: 1 }
    );
}

#[tokio::test]
async fn enterprise_and_turnstile_challenges_send_their_own_task_shapes() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("turnstile-key", Outcome::ProcessingThenReady { polls: 2 });
    let (app, usage) = gateway_on(&emulator, FAST);

    let (_, enterprise) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": Uuid::from_u128(1),
                "challenge": {
                    "kind": "recaptchaV2", "pageUrl": "https://example.com/", "siteKey": "v2e-key",
                    "enterprise": true, "dataS": "s-value",
                },
            }),
        ),
    )
    .await;
    let (_, v3) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": Uuid::from_u128(2),
                "challenge": {
                    "kind": "recaptchaV3", "pageUrl": "https://example.com/", "siteKey": "v3-key",
                    "action": "login", "enterprise": true,
                },
            }),
        ),
    )
    .await;
    let (_, turnstile) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": Uuid::from_u128(3),
                "challenge": {
                    "kind": "turnstile", "pageUrl": "http://example.com/form", "siteKey": "turnstile-key",
                    "action": "signup", "cdata": "c-data",
                },
            }),
        ),
    )
    .await;

    for body in [&enterprise, &v3, &turnstile] {
        assert_eq!(body["outcome"], "solved");
    }
    let tasks = emulator.created_tasks();
    assert_eq!(
        tasks[0].task,
        json!({
            "type": "ReCaptchaV2EnterpriseTaskProxyLess",
            "websiteURL": "https://example.com/",
            "websiteKey": "v2e-key",
            "enterprisePayload": { "s": "s-value" },
        })
    );
    assert_eq!(
        tasks[1].task,
        json!({
            "type": "ReCaptchaV3EnterpriseTaskProxyLess",
            "websiteURL": "https://example.com/",
            "websiteKey": "v3-key",
            "pageAction": "login",
        })
    );
    assert_eq!(
        tasks[2].task,
        json!({
            "type": "AntiTurnstileTaskProxyLess",
            "websiteURL": "http://example.com/form",
            "websiteKey": "turnstile-key",
            "metadata": { "action": "signup", "cdata": "c-data" },
        })
    );
    let turnstile_task = tasks[2].task_id.clone().unwrap();
    assert_eq!(emulator.polls(&turnstile_task), Some(3));
    assert_eq!(
        turnstile["token"],
        format!("emulated-token-{turnstile_task}")
    );
    let models: Vec<String> = usage
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.model.clone())
        .collect();
    assert_eq!(
        models,
        [
            "capsolver-recaptcha-v2-enterprise",
            "capsolver-recaptcha-v3-enterprise",
            "capsolver-turnstile",
        ]
    );
}

#[tokio::test]
async fn every_unsolved_outcome_is_reported_and_none_is_billed() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("unsolvable", Outcome::Unsolvable);
    emulator.set_outcome("vendor-timeout", Outcome::Timeout);
    emulator.set_outcome("forever", Outcome::Processing);
    emulator.set_outcome("limited", Outcome::RateLimited);
    emulator.set_outcome("broke", Outcome::ZeroBalance);
    let (app, usage) = gateway_on(
        &emulator,
        SolveLimits {
            max_wait: Duration::from_millis(100),
            ..FAST
        },
    );

    for (solve, (site_key, expected)) in (1_u128..).zip([
        ("unsolvable", json!({ "outcome": "unsolvable" })),
        ("vendor-timeout", json!({ "outcome": "timeout" })),
        ("forever", json!({ "outcome": "timeout" })),
        (
            "limited",
            json!({ "outcome": "vendorError", "kind": "rateLimited" }),
        ),
        (
            "broke",
            json!({ "outcome": "vendorError", "kind": "outOfBalance" }),
        ),
    ]) {
        let (status, body) = answer(
            &app,
            solve_request(
                "mak_agent",
                json!({
                    "solveId": Uuid::from_u128(solve),
                    "challenge": { "kind": "recaptchaV3", "pageUrl": "https://example.com/", "siteKey": site_key },
                }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{site_key}");
        assert_eq!(body, expected, "{site_key}");
    }

    assert_eq!(emulator.created_tasks().len(), 5);
    assert!(usage.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_repeated_solve_id_answers_the_first_result_without_a_second_task() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("slow", Outcome::ProcessingThenReady { polls: 3 });
    let (app, usage) = gateway_on(&emulator, FAST);
    let body = json!({
        "solveId": SOLVE,
        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "slow" },
    });

    // The second request arrives while the first is still polling and joins it.
    let ((_, first), (_, joined)) = tokio::join!(
        answer(&app, solve_request("mak_agent", body.clone())),
        answer(&app, solve_request("mak_agent", body.clone())),
    );
    let (_, repeated) = answer(&app, solve_request("mak_agent", body.clone())).await;
    let (status, taken) = answer(&app, solve_request("mak_other", body)).await;

    assert_eq!(first["outcome"], "solved");
    assert_eq!(joined, first);
    assert_eq!(repeated, first);
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        taken,
        json!({ "error": "this solveId belongs to another agent" })
    );
    assert_eq!(emulator.created_tasks().len(), 1);
    assert_eq!(usage.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn the_hourly_and_daily_caps_refuse_further_solves() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    for (limits, limit) in [
        (
            SolveLimits {
                hourly: 2,
                daily: 10,
                ..FAST
            },
            "hourly",
        ),
        (
            SolveLimits {
                hourly: 10,
                daily: 2,
                ..FAST
            },
            "daily",
        ),
    ] {
        let (app, _) = gateway_on(&emulator, limits);
        let mut outcomes = Vec::new();
        for solve in 1..=3_u128 {
            let (_, body) = answer(
                &app,
                solve_request(
                    "mak_agent",
                    json!({
                        "solveId": Uuid::from_u128(solve),
                        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
                    }),
                ),
            )
            .await;
            outcomes.push(body);
        }

        assert_eq!(outcomes[0]["outcome"], "solved", "{limit}");
        assert_eq!(outcomes[1]["outcome"], "solved", "{limit}");
        assert_eq!(
            outcomes[2],
            json!({ "outcome": "budgetExceeded", "limit": limit })
        );
        // The other agent has its own budget.
        let (_, other) = answer(
            &app,
            solve_request(
                "mak_other",
                json!({
                    "solveId": Uuid::from_u128(99),
                    "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
                }),
            ),
        )
        .await;
        assert_eq!(other["outcome"], "solved", "{limit}");
    }
    assert_eq!(emulator.created_tasks().len(), 6);
}

/// Says when `createTask` is called, holds it until the test opens the
/// gate, then solves.
struct GatedSolver {
    entered: Arc<tokio::sync::Notify>,
    gate: Arc<tokio::sync::Notify>,
}

impl CaptchaSolver for GatedSolver {
    async fn create_task(&self, _: &CaptchaTask) -> Result<Created, SolverError> {
        self.entered.notify_one();
        self.gate.notified().await;
        Ok(Created::Pending(TaskId::new("task-1".to_owned())))
    }

    async fn task_result(&self, _: &TaskId) -> Result<Polled, SolverError> {
        Ok(Polled::Ready(super::solves::Solution {
            token: super::solves::CaptchaToken::new("token".to_owned()),
            user_agent: None,
        }))
    }
}

#[tokio::test]
async fn a_second_solve_while_one_runs_is_refused_and_not_remembered() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let gate = Arc::new(tokio::sync::Notify::new());
    let usage = Arc::new(RecordingUsage::default());
    let app = router(CaptchaGateway::new(
        access(true),
        Some(GatedSolver {
            entered: entered.clone(),
            gate: gate.clone(),
        }),
        usage.clone(),
        FAST,
    ));
    let first = json!({
        "solveId": Uuid::from_u128(1),
        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
    });
    let second = json!({
        "solveId": Uuid::from_u128(2),
        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
    });

    let running = tokio::spawn({
        let app = app.clone();
        async move { answer(&app, solve_request("mak_agent", first)).await }
    });
    entered.notified().await;
    let (_, refused) = answer(&app, solve_request("mak_agent", second.clone())).await;
    gate.notify_one();
    let (_, solved) = running.await.unwrap();
    // The refusal was not remembered: the same id solves once a slot is free.
    gate.notify_one();
    let (_, retried) = answer(&app, solve_request("mak_agent", second)).await;

    assert_eq!(
        refused,
        json!({ "outcome": "budgetExceeded", "limit": "concurrent" })
    );
    assert_eq!(solved["outcome"], "solved");
    assert_eq!(retried["outcome"], "solved");
    assert_eq!(usage.0.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn without_a_key_every_solve_is_not_configured() {
    let usage = Arc::new(RecordingUsage::default());
    let app = router(CaptchaGateway::<Capsolver>::new(
        access(true),
        None,
        usage.clone(),
        FAST,
    ));

    let (status, body) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": SOLVE,
                "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
            }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "outcome": "notConfigured" }));
}

#[tokio::test]
async fn a_blocked_key_stops_sending_tasks_for_a_while() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    let usage = Arc::new(RecordingUsage::default());
    // The emulator refuses an empty key with ERROR_KEY_DENIED_ACCESS.
    let solver = Capsolver::new("", &emulator.base_url()).unwrap();
    let app = router(CaptchaGateway::new(access(true), Some(solver), usage, FAST));

    let mut outcomes = Vec::new();
    for solve in 1..=2_u128 {
        let (_, body) = answer(
            &app,
            solve_request(
                "mak_agent",
                json!({
                    "solveId": Uuid::from_u128(solve),
                    "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
                }),
            ),
        )
        .await;
        outcomes.push(body);
    }

    let blocked = json!({ "outcome": "vendorError", "kind": "keyBlocked" });
    assert_eq!(outcomes, [blocked.clone(), blocked]);
    assert_eq!(emulator.created_tasks().len(), 1);
}

#[tokio::test]
async fn refused_callers_and_bad_challenges_never_reach_the_vendor() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    let usage = Arc::new(RecordingUsage::default());
    let off = router(CaptchaGateway::new(
        access(false),
        Some(Capsolver::new("capsolver-key", &emulator.base_url()).unwrap()),
        usage,
        FAST,
    ));
    let (app, _) = gateway_on(&emulator, FAST);
    let valid = json!({
        "solveId": SOLVE,
        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
    });

    let (unknown, _) = answer(&app, solve_request("mak_nobody", valid.clone())).await;
    let (teammates_off, _) = answer(&off, solve_request("mak_agent", valid)).await;
    let (not_http, error) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": SOLVE,
                "challenge": { "kind": "turnstile", "pageUrl": "javascript:alert(1)", "siteKey": "key" },
            }),
        ),
    )
    .await;
    let (no_site_key, _) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": SOLVE,
                "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": " " },
            }),
        ),
    )
    .await;
    let (interstitial, _) = answer(
        &app,
        solve_request(
            "mak_agent",
            json!({
                "solveId": SOLVE,
                "challenge": { "kind": "cloudflareChallenge", "pageUrl": "https://example.com/" },
            }),
        ),
    )
    .await;

    assert_eq!(unknown, StatusCode::UNAUTHORIZED);
    assert_eq!(teammates_off, StatusCode::FORBIDDEN);
    assert_eq!(not_http, StatusCode::BAD_REQUEST);
    assert_eq!(
        error,
        json!({ "error": "pageUrl must be an absolute http(s) URL" })
    );
    assert_eq!(no_site_key, StatusCode::BAD_REQUEST);
    assert_eq!(interstitial, StatusCode::BAD_REQUEST);
    assert!(emulator.created_tasks().is_empty());
}

/// Every span field value and event recorded on this thread.
#[derive(Clone, Default)]
struct Recorded(Arc<Mutex<Vec<String>>>);

impl tracing::field::Visit for Recorded {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.0
            .lock()
            .unwrap()
            .push(format!("{}={value}", field.name()));
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0
            .lock()
            .unwrap()
            .push(format!("{}={value:?}", field.name()));
    }
}

impl<Subscriber: tracing::Subscriber> tracing_subscriber::Layer<Subscriber> for Recorded {
    fn on_new_span(
        &self,
        attributes: &tracing::span::Attributes<'_>,
        _: &tracing::span::Id,
        _: tracing_subscriber::layer::Context<'_, Subscriber>,
    ) {
        attributes.record(&mut self.clone());
    }

    fn on_record(
        &self,
        _: &tracing::span::Id,
        values: &tracing::span::Record<'_>,
        _: tracing_subscriber::layer::Context<'_, Subscriber>,
    ) {
        values.record(&mut self.clone());
    }

    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _: tracing_subscriber::layer::Context<'_, Subscriber>,
    ) {
        event.record(&mut self.clone());
    }
}

#[tokio::test]
async fn telemetry_records_the_host_and_outcome_but_never_the_token_site_key_or_path() {
    use tracing_subscriber::layer::SubscriberExt;

    let recorded = Recorded::default();
    let _default =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(recorded.clone()));
    // Callsites other tests registered without a subscriber are asked again.
    tracing::callsite::rebuild_interest_cache();

    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("site-key-unsolvable", Outcome::Unsolvable);
    let (app, _) = gateway_on(&emulator, FAST);
    for (solve, site_key) in [(1_u128, "site-key-secret"), (2, "site-key-unsolvable")] {
        answer(
            &app,
            solve_request(
                "mak_agent",
                json!({
                    "solveId": Uuid::from_u128(solve),
                    "challenge": {
                        "kind": "recaptchaV2",
                        "pageUrl": "https://shop.example.com/private-path?order=secret-query",
                        "siteKey": site_key,
                    },
                }),
            ),
        )
        .await;
    }

    let task_id = emulator.created_tasks()[0].task_id.clone().unwrap();
    let recorded = recorded.0.lock().unwrap().join("\n");
    assert!(
        recorded.contains("captcha.host=shop.example.com"),
        "{recorded}"
    );
    assert!(recorded.contains("captcha.outcome=solved"), "{recorded}");
    assert!(
        recorded.contains("captcha.outcome=unsolvable"),
        "{recorded}"
    );
    assert!(
        recorded.contains(&format!("captcha.task_id={task_id}")),
        "{recorded}"
    );
    for secret in [
        "emulated-token",
        "site-key",
        "private-path",
        "secret-query",
        "capsolver-key",
    ] {
        assert!(!recorded.contains(secret), "{secret} in {recorded}");
    }
}
