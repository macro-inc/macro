use std::sync::Mutex;

use ai_billing::DisabledAiAdmissionService;
use ai_usage::financial::{FinalizeInvocation, WriteDisposition};
use ai_usage::{
    AiFeature, FinancialFuture, TrackedInvocation, UsageAmount, UsageEvent, UsageRecorder,
    UsageTracking,
};
use axum::{body::Body, http::Request};
use capsolver_emulator::{CapsolverEmulator, Outcome};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

use super::solves::{Created, Polled, SolverError, TaskId};
use super::*;
use crate::anthropic_gateway::brain::{
    BrainAuthenticator, BrainCaller, BrainLookup, BrainLookupError, BrainRollout,
};
use crate::solver_runs::pg::PgSolverRuns;

use crate::solver_runs::test::{AGENT, OTHER_AGENT};
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

/// Usage events, and the tracking journal's observations.
#[derive(Default)]
struct RecordingUsage {
    events: Mutex<Vec<UsageEvent>>,
    tracked: Arc<Observations>,
}

impl RecordingUsage {
    fn events(&self) -> std::sync::MutexGuard<'_, Vec<UsageEvent>> {
        self.events.lock().unwrap()
    }
}

impl UsageRecorder for RecordingUsage {
    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        Some(self.tracked.clone())
    }

    fn record(&self, event: UsageEvent) {
        self.events.lock().unwrap().push(event);
    }
}

/// Every observation begun and finalized.
#[derive(Default)]
struct Observations {
    begins: Mutex<Vec<TrackedInvocation>>,
    finals: Mutex<Vec<FinalizeInvocation>>,
}

impl UsageTracking for Observations {
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        self.begins.lock().unwrap().push(request);
        Box::pin(async { Ok(WriteDisposition::Inserted) })
    }

    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        self.finals.lock().unwrap().push(evidence);
        Box::pin(async { Ok(WriteDisposition::Inserted) })
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
/// Fast polling, and the charge on, so the billing path is exercised.
const FAST: SolveLimits = SolveLimits {
    concurrent: 1,
    hourly: 20,
    daily: 100,
    poll_interval: Duration::from_millis(10),
    max_wait: Duration::from_secs(1),
    charge_users: true,
};

/// Room for every solve a test makes on one run.
const ROOMY: RunLimits = RunLimits {
    lifetime: Duration::from_secs(6 * 60),
    model_calls: 16,
    model_calls_in_flight: 2,
    solves: 10,
    concurrent: 1,
    hourly: 20,
    daily: 100,
};

/// Held shared by every test here and exclusively by the telemetry test: a
/// thread-local subscriber misses spans whose callsites another thread hits
/// at the same time.
static GATEWAY_CALLSITES: tokio::sync::RwLock<()> = tokio::sync::RwLock::const_new(());

/// Every key is held: a person drives the agent's computer past the bound.
struct Held;

impl BrainAuthenticator for Held {
    fn authenticate<'a>(&'a self, _key: &'a str) -> BrainLookup<'a> {
        Box::pin(async {
            Err(BrainLookupError::Held {
                retry_after: std::time::Duration::from_secs(10),
            })
        })
    }
}

#[tokio::test]
async fn a_held_agent_is_answered_503_with_retry_after() {
    let access = BrainAccess {
        brains: Arc::new(Held),
        rollout: rollout(true),
        admission: Arc::new(DisabledAiAdmissionService),
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        axum::http::HeaderValue::from_static("Bearer mak_agent"),
    );
    let refused = access.authorize(&headers).await.unwrap_err();
    assert_eq!(
        refused,
        BrainRefusal::Held {
            retry_after: std::time::Duration::from_secs(10)
        }
    );
    let response = brain_refused(&tracing::Span::none(), refused);
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[axum::http::header::RETRY_AFTER], "10");
}

/// Both agents exist, so their runs and solves can be stored. Hold the
/// answer for the whole test.
async fn agents(pool: &PgPool) -> tokio::sync::RwLockReadGuard<'static, ()> {
    let callsites = GATEWAY_CALLSITES.read().await;
    insert_agents(pool).await;
    callsites
}

async fn insert_agents(pool: &PgPool) {
    for agent in [AGENT, OTHER_AGENT] {
        crate::solver_runs::test::insert_agent(pool, agent)
            .await
            .unwrap();
    }
}

fn ledgers(pool: &PgPool, limits: SolveLimits) -> Ledgers {
    let runs = Arc::new(PgSolverRuns::new(pool.clone(), ROOMY));
    Ledgers {
        runs: runs.clone(),
        solves: runs,
        run_limits: ROOMY,
        solve_limits: limits,
        tasks: tokio_util::task::TaskTracker::new(),
    }
}

fn gateway_with<Solver: CaptchaSolver>(
    pool: &PgPool,
    solver: Option<Solver>,
    limits: SolveLimits,
) -> (Router, Arc<RecordingUsage>) {
    let usage = Arc::new(RecordingUsage::default());
    let gateway = CaptchaGateway::new(
        access(true),
        solver,
        true,
        usage.clone(),
        ledgers(pool, limits),
    );
    (router(gateway), usage)
}

fn gateway_on(
    pool: &PgPool,
    emulator: &CapsolverEmulator,
    limits: SolveLimits,
) -> (Router, Arc<RecordingUsage>) {
    let solver = Capsolver::new("capsolver-key", &emulator.base_url()).unwrap();
    gateway_with(pool, Some(solver), limits)
}

fn runs_request(key: &str) -> Request<Body> {
    Request::post("/brain/captcha/runs")
        .header("authorization", format!("Bearer {key}"))
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap()
}

/// Start a run for the agent `key` authenticates.
async fn start_run(app: &Router, key: &str) -> String {
    let (status, body) = answer(app, runs_request(key)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["outcome"], "started", "{body}");
    body["runId"].as_str().unwrap().to_owned()
}

fn solve_request(key: &str, run: &str, body: Value) -> Request<Body> {
    Request::post("/brain/captcha/solve")
        .header("authorization", format!("Bearer {key}"))
        .header("content-type", "application/json")
        .header("x-macro-solver-run", run)
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_recaptcha_v2_is_solved_from_its_page_without_query_and_billed_once(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let (app, usage) = gateway_on(&pool, &emulator, FAST);
    let run = start_run(&app, "mak_agent").await;

    let (status, body) = answer(
        &app,
        solve_request(
            "mak_agent",
            &run,
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
    assert!(tasks[0].client_key_sent);
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
    let events = usage.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].user.as_ref(), AGENT);
    assert_eq!(events[0].feature, AiFeature::AgentSession);
    assert_eq!(events[0].model, "capsolver-recaptcha-v2");
    assert_eq!(
        events[0].amount,
        UsageAmount::ProviderCredits { credits: 1 }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enterprise_and_turnstile_challenges_send_their_own_task_shapes(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("turnstile-key", Outcome::ProcessingThenReady { polls: 2 });
    let (app, usage) = gateway_on(&pool, &emulator, FAST);
    let run = start_run(&app, "mak_agent").await;

    let (_, enterprise) = answer(
        &app,
        solve_request(
            "mak_agent",
            &run,
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
            &run,
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
            &run,
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
        .events()
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_unsolved_outcome_is_reported_and_none_is_billed(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("unsolvable", Outcome::Unsolvable);
    emulator.set_outcome("vendor-timeout", Outcome::Timeout);
    emulator.set_outcome("limited", Outcome::RateLimited);
    emulator.set_outcome("broke", Outcome::ZeroBalance);
    // Long enough that a slow runner never turns an answer into a timeout.
    let (app, usage) = gateway_on(
        &pool,
        &emulator,
        SolveLimits {
            max_wait: Duration::from_secs(60),
            ..FAST
        },
    );
    let run = start_run(&app, "mak_agent").await;

    for (solve, (site_key, expected)) in (1_u128..).zip([
        ("unsolvable", json!({ "outcome": "unsolvable" })),
        ("vendor-timeout", json!({ "outcome": "timeout" })),
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
                &run,
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

    assert_eq!(emulator.created_tasks().len(), 4);
    assert!(usage.events().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_task_still_processing_at_the_deadline_times_out_unbilled(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("forever", Outcome::Processing);
    let (app, usage) = gateway_on(
        &pool,
        &emulator,
        SolveLimits {
            max_wait: Duration::from_millis(100),
            ..FAST
        },
    );
    let run = start_run(&app, "mak_agent").await;

    let (status, body) = answer(
        &app,
        solve_request(
            "mak_agent",
            &run,
            json!({
                "solveId": SOLVE,
                "challenge": { "kind": "recaptchaV3", "pageUrl": "https://example.com/", "siteKey": "forever" },
            }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "outcome": "timeout" }));
    assert_eq!(emulator.created_tasks().len(), 1);
    assert!(usage.events().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_repeated_solve_id_on_another_replica_replays_without_a_second_task(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    // Two gateways over one database, as two harness replicas are.
    let (app, usage) = gateway_on(&pool, &emulator, FAST);
    let (replica, replica_usage) = gateway_on(&pool, &emulator, FAST);
    let run = start_run(&app, "mak_agent").await;
    let other_run = start_run(&replica, "mak_other").await;
    let body = json!({
        "solveId": SOLVE,
        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
    });

    let (_, first) = answer(&app, solve_request("mak_agent", &run, body.clone())).await;
    let (_, repeated) = answer(&replica, solve_request("mak_agent", &run, body.clone())).await;
    let (status, taken) = answer(&replica, solve_request("mak_other", &other_run, body)).await;

    assert_eq!(first["outcome"], "solved");
    // The token was only in the first answer: the ledger never kept it, so
    // the repeat says to solve again, without a second task.
    assert_eq!(repeated, json!({ "outcome": "timeout" }));
    let kept = sqlx::query_scalar!("SELECT outcome FROM agent_captcha_solves")
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(kept["outcome"], "solved");
    assert!(kept.get("token").is_none(), "{kept}");
    assert!(kept.get("userAgent").is_none(), "{kept}");
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        taken,
        json!({ "error": "this solveId belongs to another agent", "code": "solve_id_taken" })
    );
    assert_eq!(emulator.created_tasks().len(), 1);
    assert_eq!(usage.events().len(), 1);
    assert!(replica_usage.events().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_hourly_and_daily_caps_refuse_further_solves(pool: PgPool) {
    let _callsites = agents(&pool).await;
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
        sqlx::query!("DELETE FROM agent_captcha_runs")
            .execute(&pool)
            .await
            .unwrap();
        let (app, _) = gateway_on(&pool, &emulator, limits);
        let run = start_run(&app, "mak_agent").await;
        let other_run = start_run(&app, "mak_other").await;
        let mut outcomes = Vec::new();
        for solve in 1..=3_u128 {
            let (_, body) = answer(
                &app,
                solve_request(
                    "mak_agent",
                    &run,
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
                &other_run,
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_second_solve_while_one_runs_is_refused_and_not_remembered(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let entered = Arc::new(tokio::sync::Notify::new());
    let gate = Arc::new(tokio::sync::Notify::new());
    let (app, usage) = gateway_with(
        &pool,
        Some(GatedSolver {
            entered: entered.clone(),
            gate: gate.clone(),
        }),
        FAST,
    );
    let run = start_run(&app, "mak_agent").await;
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
        let run = run.clone();
        let first = first.clone();
        async move { answer(&app, solve_request("mak_agent", &run, first)).await }
    });
    entered.notified().await;
    let (_, refused) = answer(&app, solve_request("mak_agent", &run, second.clone())).await;
    // Still being solved, on this replica or another: no second task, no wait.
    let (joined_status, joined) =
        answer(&app, solve_request("mak_agent", &run, first.clone())).await;
    gate.notify_one();
    let (_, solved) = running.await.unwrap();
    // The refusal was not remembered: the same id solves once a slot is free.
    gate.notify_one();
    let (_, retried) = answer(&app, solve_request("mak_agent", &run, second)).await;

    assert_eq!(
        refused,
        json!({ "outcome": "budgetExceeded", "limit": "concurrent" })
    );
    assert_eq!(joined_status, StatusCode::CONFLICT);
    assert_eq!(joined["code"], "solve_in_progress");
    assert_eq!(solved["outcome"], "solved");
    assert_eq!(retried["outcome"], "solved");
    assert_eq!(usage.events().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_both_keys_runs_and_solves_are_not_configured(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let (no_capsolver, _) = gateway_with::<Capsolver>(&pool, None, FAST);
    let no_fireworks = router(CaptchaGateway::new(
        access(true),
        Some(Capsolver::new("capsolver-key", &emulator.base_url()).unwrap()),
        false,
        Arc::new(RecordingUsage::default()),
        ledgers(&pool, FAST),
    ));

    let (_, capsolver_run) = answer(&no_capsolver, runs_request("mak_agent")).await;
    let (_, fireworks_run) = answer(&no_fireworks, runs_request("mak_agent")).await;
    // No run is needed to hear that nothing can be solved.
    let (status, solve) = answer(
        &no_capsolver,
        Request::post("/brain/captcha/solve")
            .header("authorization", "Bearer mak_agent")
            .body(Body::from(
                json!({
                    "solveId": SOLVE,
                    "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
                })
                .to_string(),
            ))
            .unwrap(),
    )
    .await;

    assert_eq!(capsolver_run, json!({ "outcome": "notConfigured" }));
    assert_eq!(fireworks_run, json!({ "outcome": "notConfigured" }));
    assert_eq!(status, StatusCode::OK);
    assert_eq!(solve, json!({ "outcome": "notConfigured" }));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_answers_its_budget_and_one_is_live_per_agent(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let (app, _) = gateway_on(&pool, &emulator, FAST);

    let (status, started) = answer(&app, runs_request("mak_agent")).await;
    let (_, second) = answer(&app, runs_request("mak_agent")).await;
    let (_, other) = answer(&app, runs_request("mak_other")).await;
    let (unknown, _) = answer(&app, runs_request("mak_nobody")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(started["outcome"], "started");
    assert_eq!(started["modelCalls"], 16);
    assert_eq!(started["solves"], 10);
    let run_id = Uuid::parse_str(started["runId"].as_str().unwrap()).unwrap();
    assert_eq!(run_id.get_version_num(), 7);
    let expires_at =
        chrono::DateTime::parse_from_rfc3339(started["expiresAt"].as_str().unwrap()).unwrap();
    assert!(expires_at > chrono::Utc::now() + chrono::Duration::minutes(5));
    assert_eq!(
        second,
        json!({ "outcome": "budgetExceeded", "limit": "concurrent" })
    );
    assert_eq!(other["outcome"], "started");
    assert_eq!(unknown, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_solve_needs_a_live_run_of_its_own(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let (app, _) = gateway_on(&pool, &emulator, FAST);
    let run = start_run(&app, "mak_agent").await;
    let other_run = start_run(&app, "mak_other").await;
    let body = json!({
        "solveId": SOLVE,
        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
    });
    let mut without_run = solve_request("mak_agent", &run, body.clone());
    without_run.headers_mut().remove("x-macro-solver-run");

    let (missing, missing_body) = answer(&app, without_run).await;
    let (theirs, theirs_body) =
        answer(&app, solve_request("mak_agent", &other_run, body.clone())).await;
    sqlx::query!("UPDATE agent_captcha_runs SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let (expired, expired_body) = answer(&app, solve_request("mak_agent", &run, body)).await;

    assert_eq!(missing, StatusCode::FORBIDDEN);
    assert_eq!(missing_body["code"], "solver_run_required");
    assert_eq!(theirs, StatusCode::FORBIDDEN);
    assert_eq!(theirs_body["code"], "solver_run_required");
    assert_eq!(expired, StatusCode::FORBIDDEN);
    assert_eq!(expired_body["code"], "solver_run_expired");
    assert!(emulator.created_tasks().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_allows_two_solves(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let usage = Arc::new(RecordingUsage::default());
    let runs = Arc::new(PgSolverRuns::new(pool.clone(), RunLimits::default()));
    let app = router(CaptchaGateway::new(
        access(true),
        Some(Capsolver::new("capsolver-key", &emulator.base_url()).unwrap()),
        true,
        usage,
        Ledgers {
            runs: runs.clone(),
            solves: runs,
            run_limits: RunLimits::default(),
            solve_limits: FAST,
            tasks: tokio_util::task::TaskTracker::new(),
        },
    ));
    let run = start_run(&app, "mak_agent").await;

    let mut answers = Vec::new();
    for solve in 1..=3_u128 {
        answers.push(
            answer(
                &app,
                solve_request(
                    "mak_agent",
                    &run,
                    json!({
                        "solveId": Uuid::from_u128(solve),
                        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
                    }),
                ),
            )
            .await,
        );
    }

    assert_eq!(answers[0].1["outcome"], "solved");
    assert_eq!(answers[1].1["outcome"], "solved");
    assert_eq!(answers[2].0, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(answers[2].1["code"], "solver_run_exhausted");
    assert_eq!(emulator.created_tasks().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_blocked_key_stops_sending_tasks_for_a_while(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    // The emulator refuses an empty key with ERROR_KEY_DENIED_ACCESS.
    let solver = Capsolver::new("", &emulator.base_url()).unwrap();
    let (app, _) = gateway_with(&pool, Some(solver), FAST);
    let run = start_run(&app, "mak_agent").await;

    let mut outcomes = Vec::new();
    for solve in 1..=2_u128 {
        let (_, body) = answer(
            &app,
            solve_request(
                "mak_agent",
                &run,
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn refused_callers_and_bad_challenges_never_reach_the_vendor(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let off = router(CaptchaGateway::new(
        access(false),
        Some(Capsolver::new("capsolver-key", &emulator.base_url()).unwrap()),
        true,
        Arc::new(RecordingUsage::default()),
        ledgers(&pool, FAST),
    ));
    let (app, _) = gateway_on(&pool, &emulator, FAST);
    let run = start_run(&app, "mak_agent").await;
    let valid = json!({
        "solveId": SOLVE,
        "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
    });

    let (unknown, _) = answer(&app, solve_request("mak_nobody", &run, valid.clone())).await;
    let (teammates_off, _) = answer(&off, solve_request("mak_agent", &run, valid)).await;
    let (not_http, error) = answer(
        &app,
        solve_request(
            "mak_agent",
            &run,
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
            &run,
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
            &run,
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn telemetry_records_the_host_and_outcome_but_never_the_token_site_key_or_path(pool: PgPool) {
    let _callsites = GATEWAY_CALLSITES.write().await;
    insert_agents(&pool).await;
    use tracing_subscriber::layer::SubscriberExt;

    let recorded = Recorded::default();
    let _default =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(recorded.clone()));
    // Callsites other tests registered without a subscriber are asked again.
    tracing::callsite::rebuild_interest_cache();

    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("site-key-unsolvable", Outcome::Unsolvable);
    let (app, _) = gateway_on(&pool, &emulator, FAST);
    let run = start_run(&app, "mak_agent").await;
    for (solve, site_key) in [(1_u128, "site-key-secret"), (2, "site-key-unsolvable")] {
        answer(
            &app,
            solve_request(
                "mak_agent",
                &run,
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_solves_back_to_back_each_get_a_run(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let (app, _) = gateway_on(&pool, &emulator, FAST);

    let mut outcomes = Vec::new();
    for solve in 1..=2_u128 {
        let run = start_run(&app, "mak_agent").await;
        let (_, solved) = answer(
            &app,
            solve_request(
                "mak_agent",
                &run,
                json!({
                    "solveId": Uuid::from_u128(solve),
                    "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
                }),
            ),
        )
        .await;
        outcomes.push(solved["outcome"].clone());
        let (status, ended) = answer(
            &app,
            Request::post(format!("/brain/captcha/runs/{run}/end"))
                .header("authorization", "Bearer mak_agent")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(ended, json!({ "outcome": "ended" }));
    }

    assert_eq!(outcomes, vec![json!("solved"), json!("solved")]);
    assert_eq!(emulator.created_tasks().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn with_the_charge_off_a_solve_is_observed_but_not_charged(pool: PgPool) {
    let _callsites = agents(&pool).await;
    let emulator = CapsolverEmulator::start().await.unwrap();
    let (app, usage) = gateway_on(
        &pool,
        &emulator,
        SolveLimits {
            charge_users: false,
            ..FAST
        },
    );
    let run = start_run(&app, "mak_agent").await;

    let (_, body) = answer(
        &app,
        solve_request(
            "mak_agent",
            &run,
            json!({
                "solveId": SOLVE,
                "challenge": { "kind": "turnstile", "pageUrl": "https://example.com/", "siteKey": "key" },
            }),
        ),
    )
    .await;

    assert_eq!(body["outcome"], "solved");
    assert!(usage.events().is_empty());
    let finals = usage.tracked.finals.lock().unwrap();
    assert_eq!(finals.len(), 1);
    assert!(finals[0].provider_request_id.is_some());
}

#[test]
fn solves_are_not_charged_to_users_by_default() {
    assert!(!SolveLimits::default().charge_users);
}
