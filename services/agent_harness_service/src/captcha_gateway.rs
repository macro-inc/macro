//! `POST /brain/captcha/runs` and `POST /brain/captcha/solve`: agent
//! teammates' CAPTCHA runs and solves, on Macro's CapSolver key.
//!
//! A CAPTCHA run starts a solver run (`/runs`), whose id every model call
//! and solve of the run sends as `x-macro-solver-run` (see
//! [`crate::solver_runs`]). The agent's `captcha` MCP reads a challenge off
//! its own current page and sends it to `/solve` with the agent's Macro API
//! key. The gateway authenticates the agent, admits it, and hands the
//! challenge to [`solves::Solves`], which takes it from the run, sends one
//! task per `solveId` to the vendor, polls it and bills a solved one. Every
//! answer the vendor decided is a 200 tagged by `outcome`; a refused run is
//! a 403 or 429 with a `code`.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{Instrument, field::Empty};
use uuid::Uuid;

use crate::anthropic_gateway::brain::BrainAccess;
use crate::solver_runs::{
    self, BudgetLimit, RunLimits, RunStart, SolveLedger, SolverRunId, SolverRuns,
};
use solves::{CaptchaSolver, CaptchaTask, Challenge, SolveRefused, Solves};

mod capsolver;
mod solves;

pub(crate) use capsolver::Capsolver;
pub(crate) use solves::{KeptOutcome, SolveLimits, SolveOutcome, VendorErrorKind};

#[cfg(test)]
mod test;

/// Largest request body; a challenge is a URL and a few short strings.
const MAX_REQUEST_BYTES: usize = 64 * 1024;

/// The CAPTCHA route's state.
pub(crate) struct CaptchaGateway<Solver> {
    access: BrainAccess,
    runs: Arc<dyn SolverRuns>,
    run_limits: RunLimits,
    /// Whether the run's model (Fireworks) has a key: a run needs both.
    model_configured: bool,
    solves: Solves<Solver>,
}

/// Where a gateway keeps its runs and solves, and the limits they count.
pub(crate) struct Ledgers {
    pub(crate) runs: Arc<dyn SolverRuns>,
    pub(crate) solves: Arc<dyn SolveLedger>,
    pub(crate) run_limits: RunLimits,
    pub(crate) solve_limits: SolveLimits,
    /// Where solves run; shutdown waits for it.
    pub(crate) tasks: tokio_util::task::TaskTracker,
}

impl<Solver: CaptchaSolver> CaptchaGateway<Solver> {
    /// `solver` is `None` when no vendor key is configured: every solve
    /// answers `notConfigured`, and so does every run, as it does when
    /// `model_configured` is false.
    pub(crate) fn new(
        access: BrainAccess,
        solver: Option<Solver>,
        model_configured: bool,
        recorder: Arc<dyn ai_usage::UsageRecorder>,
        ledgers: Ledgers,
    ) -> Self {
        Self {
            access,
            runs: ledgers.runs,
            run_limits: ledgers.run_limits,
            model_configured,
            solves: Solves::new(
                solver,
                ledgers.solves,
                recorder,
                ledgers.solve_limits,
                ledgers.tasks,
            ),
        }
    }
}

/// The CAPTCHA routes, merged into the egress gateway router.
pub(crate) fn router<Solver: CaptchaSolver>(gateway: CaptchaGateway<Solver>) -> Router {
    Router::new()
        .route("/brain/captcha/runs", post(start_run::<Solver>))
        .route("/brain/captcha/runs/{run_id}/end", post(end_run::<Solver>))
        .route("/brain/captcha/solve", post(solve::<Solver>))
        .with_state(Arc::new(gateway))
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_millis(200))
                .into_inner(),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolveRequest {
    /// The caller's idempotency key.
    solve_id: Uuid,
    challenge: Challenge,
}

async fn solve<Solver: CaptchaSolver>(
    State(gateway): State<Arc<CaptchaGateway<Solver>>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let span = tracing::info_span!(
        "captcha_gateway.solve",
        captcha.kind = Empty,
        captcha.host = Empty,
        captcha.outcome = Empty,
        captcha.task_id = Empty,
        captcha.polls = Empty,
        captcha.run_id = Empty,
        agent.user.id = Empty,
        agent.team.id = Empty,
        http.response.status_code = Empty,
        otel.status_code = Empty,
    );
    let refused = |status: StatusCode, outcome: &'static str, message: &str| {
        refusal(&span, status, outcome, None, message)
    };

    let brain = match gateway
        .access
        .authorize(&headers)
        .instrument(span.clone())
        .await
    {
        Ok(brain) => brain,
        Err(status) => return refused(status, "unauthorized", "the agent may not solve CAPTCHAs"),
    };
    span.record(
        "agent.user.id",
        agent_credentials::telemetry_id(brain.user_id.as_ref()),
    );
    span.record("agent.team.id", tracing::field::display(brain.team_id));

    if body.len() > MAX_REQUEST_BYTES {
        return refused(
            StatusCode::PAYLOAD_TOO_LARGE,
            "invalid_request",
            "the request is too large",
        );
    }
    let Ok(request) = serde_json::from_slice::<SolveRequest>(&body) else {
        return refused(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "send {solveId, challenge: {kind, pageUrl, siteKey, ...}}",
        );
    };
    let task = match CaptchaTask::new(request.challenge) {
        Ok(task) => task,
        Err(error) => {
            span.record("captcha.outcome", "invalid_request");
            span.record("http.response.status_code", 400);
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };
    span.record("captcha.kind", <&'static str>::from(task.task_type));
    span.record("captcha.host", task.host.as_str());

    // Without a key nothing is spent, so no run is needed to say so.
    let run = match solver_runs::run_header(&headers) {
        Some(run) => run,
        None if !gateway.solves.configured() => {
            span.record("captcha.outcome", SolveOutcome::NotConfigured.as_str());
            span.record("http.response.status_code", 200);
            return Json(SolveOutcome::NotConfigured).into_response();
        }
        None => {
            let refused = solver_runs::RunRefusal::Required;
            return refusal(
                &span,
                refused.status(),
                "run_refused",
                Some(refused.code()),
                refused.message(),
            );
        }
    };
    span.record("captcha.run_id", tracing::field::display(run.0));

    match gateway
        .solves
        .solve(&brain, run, request.solve_id, task, &span)
        .instrument(span.clone())
        .await
    {
        Ok(outcome) => {
            span.record("captcha.outcome", outcome.as_str());
            span.record("http.response.status_code", 200);
            Json(outcome).into_response()
        }
        Err(refused) => {
            let message = refused.to_string();
            let (status, outcome, code) = match refused {
                SolveRefused::OtherAgent => (StatusCode::CONFLICT, "conflict", "solve_id_taken"),
                SolveRefused::InProgress => {
                    (StatusCode::CONFLICT, "in_progress", "solve_in_progress")
                }
                SolveRefused::Run(refusal) => (refusal.status(), "run_refused", refusal.code()),
                SolveRefused::Ledger(error) => {
                    tracing::error!(error = ?error, "the solves ledger failed");
                    return refusal(
                        &span,
                        StatusCode::SERVICE_UNAVAILABLE,
                        "unavailable",
                        Some("unavailable"),
                        "the solve could not be recorded; try again",
                    );
                }
            };
            refusal(&span, status, outcome, Some(code), &message)
        }
    }
}

/// A refusal as `{"error": message, "code"?: code}`, recorded on `span`.
fn refusal(
    span: &tracing::Span,
    status: StatusCode,
    outcome: &'static str,
    code: Option<&'static str>,
    message: &str,
) -> Response {
    span.record("captcha.outcome", outcome);
    span.record("http.response.status_code", i64::from(status.as_u16()));
    if status.is_server_error() {
        span.record("otel.status_code", "ERROR");
    }
    let body = match code {
        Some(code) => serde_json::json!({ "error": message, "code": code }),
        None => serde_json::json!({ "error": message }),
    };
    (status, Json(body)).into_response()
}

/// What `/brain/captcha/runs` answers.
#[derive(Debug, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum RunAnswer {
    Started {
        run_id: SolverRunId,
        expires_at: DateTime<Utc>,
        model_calls: u16,
        solves: u16,
    },
    BudgetExceeded {
        limit: BudgetLimit,
    },
    NotConfigured,
}

impl RunAnswer {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Started { .. } => "started",
            Self::BudgetExceeded { .. } => "budget_exceeded",
            Self::NotConfigured => "not_configured",
        }
    }
}

/// `POST /brain/captcha/runs/{run_id}/end`: the solver tool is done with its
/// run, so the agent may start the next one at once. Idempotent: an ended,
/// expired or unknown run, or another agent's, answers the same and changes
/// nothing.
async fn end_run<Solver: CaptchaSolver>(
    State(gateway): State<Arc<CaptchaGateway<Solver>>>,
    Path(run_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let span = tracing::info_span!(
        "captcha_gateway.end_run",
        captcha.run_id = %run_id,
        captcha.outcome = Empty,
        agent.user.id = Empty,
        agent.team.id = Empty,
        http.response.status_code = Empty,
        otel.status_code = Empty,
    );
    let brain = match gateway
        .access
        .authorize(&headers)
        .instrument(span.clone())
        .await
    {
        Ok(brain) => brain,
        Err(status) => {
            return refusal(
                &span,
                status,
                "unauthorized",
                None,
                "the agent may not solve CAPTCHAs",
            );
        }
    };
    span.record(
        "agent.user.id",
        agent_credentials::telemetry_id(brain.user_id.as_ref()),
    );
    span.record("agent.team.id", tracing::field::display(brain.team_id));

    if let Err(error) = gateway
        .runs
        .end(SolverRunId(run_id), &brain.user_id)
        .instrument(span.clone())
        .await
    {
        tracing::error!(parent: &span, error = ?error, "the solver run could not be ended");
        return refusal(
            &span,
            StatusCode::SERVICE_UNAVAILABLE,
            "unavailable",
            Some("unavailable"),
            "the solver run could not be ended; it ends when it expires",
        );
    }
    span.record("captcha.outcome", "ended");
    span.record("http.response.status_code", 200);
    Json(serde_json::json!({ "outcome": "ended" })).into_response()
}

async fn start_run<Solver: CaptchaSolver>(
    State(gateway): State<Arc<CaptchaGateway<Solver>>>,
    headers: HeaderMap,
) -> Response {
    let span = tracing::info_span!(
        "captcha_gateway.start_run",
        captcha.run_id = Empty,
        captcha.outcome = Empty,
        agent.user.id = Empty,
        agent.team.id = Empty,
        http.response.status_code = Empty,
        otel.status_code = Empty,
    );
    let brain = match gateway
        .access
        .authorize(&headers)
        .instrument(span.clone())
        .await
    {
        Ok(brain) => brain,
        Err(status) => {
            return refusal(
                &span,
                status,
                "unauthorized",
                None,
                "the agent may not solve CAPTCHAs",
            );
        }
    };
    span.record(
        "agent.user.id",
        agent_credentials::telemetry_id(brain.user_id.as_ref()),
    );
    span.record("agent.team.id", tracing::field::display(brain.team_id));

    let answer = if !gateway.model_configured || !gateway.solves.configured() {
        RunAnswer::NotConfigured
    } else {
        match gateway
            .runs
            .start(&brain.user_id)
            .instrument(span.clone())
            .await
        {
            Ok(RunStart::Started { run_id, expires_at }) => {
                span.record("captcha.run_id", tracing::field::display(run_id.0));
                RunAnswer::Started {
                    run_id,
                    expires_at,
                    model_calls: gateway.run_limits.model_calls,
                    solves: gateway.run_limits.solves,
                }
            }
            Ok(RunStart::BudgetExceeded(limit)) => RunAnswer::BudgetExceeded { limit },
            Err(error) => {
                tracing::error!(parent: &span, error = ?error, "the solver run could not be started");
                return refusal(
                    &span,
                    StatusCode::SERVICE_UNAVAILABLE,
                    "unavailable",
                    Some("unavailable"),
                    "the solver run could not be started; try again",
                );
            }
        }
    };
    span.record("captcha.outcome", answer.as_str());
    span.record("http.response.status_code", 200);
    Json(answer).into_response()
}
