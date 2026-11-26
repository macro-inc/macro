//! The adapter against servers that misbehave, and against the real
//! CapSolver. The live test is ignored: it spends real credits, and needs
//! `CAPSOLVER_API_KEY` in the process environment:
//!
//! ```sh
//! CAPSOLVER_API_KEY=... cargo test -p agent_harness_service \
//!   capsolver_live_contract -- --ignored --nocapture
//! ```

use std::sync::Arc;
use std::time::Duration;

use ai_usage::{UsageEvent, UsageRecorder};
use axum::Router;
use axum::body::Body;
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::post;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::json;
use uuid::Uuid;

use super::{Capsolver, MAX_RESPONSE_BYTES};
use crate::anthropic_gateway::brain::BrainCaller;
use crate::captcha_gateway::solves::{
    CaptchaSolver, CaptchaTask, Challenge, Created, SolveLimits, SolveOutcome, SolverError, Solves,
    VendorErrorKind,
};
use crate::config::CapsolverApiKey;
use crate::solver_runs::{Claimed, LedgerError, SolveClaim, SolveLedger, SolverRunId};

/// Google's and Cloudflare's published always-pass test site keys, on a page
/// that doesn't exist: the vendor needs no real page for them.
const TURNSTILE_TEST_KEY: &str = "1x00000000000000000000AA";
const RECAPTCHA_V2_TEST_KEY: &str = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
const FIXTURE_PAGE: &str = "http://127.0.0.1/captcha-fixture";

struct NoUsage;

impl UsageRecorder for NoUsage {
    fn record(&self, _event: UsageEvent) {}
}

/// Admits every solve and keeps nothing: the contract is the vendor's.
struct EverySolve;

#[async_trait::async_trait]
impl SolveLedger for EverySolve {
    async fn claim(&self, _: &SolveClaim) -> Result<Claimed, LedgerError> {
        Ok(Claimed::New)
    }

    async fn finish(&self, _: Uuid, _: &SolveOutcome, _: Option<&str>) -> Result<(), LedgerError> {
        Ok(())
    }
}

/// A CapSolver origin serving `app`, and a client for it.
async fn capsolver_serving(app: Router) -> Capsolver {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Capsolver::new("capsolver-key", &base_url).unwrap()
}

fn recaptcha_task() -> CaptchaTask {
    CaptchaTask::new(Challenge::RecaptchaV2 {
        page_url: "https://example.com/login".to_owned(),
        site_key: "site".to_owned(),
        invisible: false,
        enterprise: false,
        data_s: None,
        action: None,
    })
    .unwrap()
}

fn created_task() -> serde_json::Value {
    json!({ "errorId": 0, "status": "idle", "taskId": "task-1" })
}

#[tokio::test]
async fn a_redirect_is_not_followed_with_the_key() {
    let followed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let app = Router::new()
        .route(
            "/createTask",
            post(|| async {
                (
                    StatusCode::TEMPORARY_REDIRECT,
                    [(header::LOCATION, "/elsewhere")],
                )
            }),
        )
        .route(
            "/elsewhere",
            post({
                let followed = followed.clone();
                move || async move {
                    followed.store(true, std::sync::atomic::Ordering::SeqCst);
                    axum::Json(created_task())
                }
            }),
        );
    let capsolver = capsolver_serving(app).await;

    let created = capsolver.create_task(&recaptcha_task()).await;

    assert_eq!(
        created.unwrap_err(),
        SolverError::Vendor(VendorErrorKind::Unavailable)
    );
    assert!(
        !followed.load(std::sync::atomic::Ordering::SeqCst),
        "the body with clientKey was resent to the redirect target"
    );
}

#[tokio::test]
async fn a_failed_status_with_a_success_body_is_unavailable() {
    let app = Router::new().route(
        "/createTask",
        post(|| async { (StatusCode::BAD_GATEWAY, axum::Json(created_task())) }),
    );
    let capsolver = capsolver_serving(app).await;

    let created = capsolver.create_task(&recaptcha_task()).await;

    assert_eq!(
        created.unwrap_err(),
        SolverError::Vendor(VendorErrorKind::Unavailable)
    );
}

#[tokio::test]
async fn a_vendor_error_on_a_failed_status_keeps_its_code() {
    let app = Router::new().route(
        "/createTask",
        post(|| async {
            (
                StatusCode::BAD_REQUEST,
                axum::Json(json!({ "errorId": 1, "errorCode": "ERROR_ZERO_BALANCE" })),
            )
        }),
    );
    let capsolver = capsolver_serving(app).await;

    let created = capsolver.create_task(&recaptcha_task()).await;

    assert_eq!(
        created.unwrap_err(),
        SolverError::Vendor(VendorErrorKind::OutOfBalance)
    );
}

#[tokio::test]
async fn an_endless_response_is_cut_off_at_the_limit() {
    let app = Router::new().route(
        "/createTask",
        post(|| async {
            let chunk = axum::body::Bytes::from(vec![b' '; 16 * 1024]);
            let endless = futures::stream::repeat_with(move || {
                Ok::<_, std::convert::Infallible>(chunk.clone())
            });
            Body::from_stream(endless).into_response()
        }),
    );
    let capsolver = capsolver_serving(app).await;

    // Reading it all would never finish; the limit stops it at once.
    let created = tokio::time::timeout(
        Duration::from_secs(5),
        capsolver.create_task(&recaptcha_task()),
    )
    .await
    .expect("the response was read past the limit");

    assert_eq!(
        created.unwrap_err(),
        SolverError::Vendor(VendorErrorKind::Unavailable)
    );
}

#[tokio::test]
async fn a_response_at_the_limit_is_read() {
    let mut body = serde_json::to_vec(&created_task()).unwrap();
    body.resize(MAX_RESPONSE_BYTES, b' ');
    let app = Router::new().route("/createTask", post(move || async move { body }));
    let capsolver = capsolver_serving(app).await;

    let created = capsolver.create_task(&recaptcha_task()).await.unwrap();

    assert!(matches!(created, Created::Pending(_)), "{created:?}");
}

#[tokio::test]
#[ignore = "calls the real CapSolver and spends credits; needs CAPSOLVER_API_KEY"]
async fn capsolver_live_contract() {
    let Some(key) = CapsolverApiKey::new()
        .as_ref()
        .and_then(CapsolverApiKey::value)
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
    else {
        panic!(
            "capsolver_live_contract needs CAPSOLVER_API_KEY set to a CapSolver key in the \
             process environment; it is unset or blank"
        );
    };
    let base_url = macro_service_urls::CapsolverApiUrl::new().unwrap();
    let solves = Solves::new(
        Some(Capsolver::new(&key, base_url.as_str()).unwrap()),
        Arc::new(EverySolve),
        Arc::new(NoUsage),
        SolveLimits::default(),
        tokio_util::task::TaskTracker::new(),
    );
    let agent = BrainCaller {
        user_id: MacroUserIdStr::parse_from_str("macro|live-contract@agents.macro.invalid")
            .unwrap()
            .into_owned(),
        team_id: Uuid::now_v7(),
    };

    let challenges = [
        (
            "turnstile",
            Challenge::Turnstile {
                page_url: FIXTURE_PAGE.to_owned(),
                site_key: TURNSTILE_TEST_KEY.to_owned(),
                action: None,
                cdata: None,
            },
        ),
        (
            "recaptchaV2",
            Challenge::RecaptchaV2 {
                page_url: FIXTURE_PAGE.to_owned(),
                site_key: RECAPTCHA_V2_TEST_KEY.to_owned(),
                invisible: false,
                enterprise: false,
                data_s: None,
                action: None,
            },
        ),
    ];
    let mut outcomes = Vec::new();
    for (name, challenge) in challenges {
        let outcome = solves
            .solve(
                &agent,
                SolverRunId(Uuid::now_v7()),
                Uuid::now_v7(),
                CaptchaTask::new(challenge).unwrap(),
                &tracing::Span::none(),
            )
            .await
            .unwrap();
        // The token's Debug is redacted; a vendor error shows its kind.
        eprintln!("{name}: {outcome:?}");
        outcomes.push((name, outcome));
    }

    for (name, outcome) in outcomes {
        match outcome {
            SolveOutcome::Solved { token, .. } => {
                let token = serde_json::to_value(&token).unwrap();
                assert!(
                    token.as_str().is_some_and(|token| !token.is_empty()),
                    "{name} came back with no token"
                );
            }
            other => panic!("{name} was not solved: {other:?}"),
        }
    }
}
