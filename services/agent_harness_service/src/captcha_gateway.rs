//! `POST /brain/captcha/solve`: agent teammates' CAPTCHA solves, on Macro's
//! CapSolver key.
//!
//! The agent's `captcha` MCP reads a challenge off its own current page and
//! sends it here with the agent's Macro API key. The gateway authenticates
//! the agent, admits it, and hands the challenge to [`solves::Solves`], which
//! sends one task per `solveId` to the vendor, polls it and bills a solved
//! one. Every answer the vendor decided is a 200 tagged by `outcome`.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use tracing::{Instrument, field::Empty};
use uuid::Uuid;

use crate::anthropic_gateway::brain::BrainAccess;
use solves::{CaptchaSolver, CaptchaTask, Challenge, Solves};

mod capsolver;
mod solves;

pub(crate) use capsolver::Capsolver;
pub(crate) use solves::SolveLimits;

#[cfg(test)]
mod test;

/// Largest request body; a challenge is a URL and a few short strings.
const MAX_REQUEST_BYTES: usize = 64 * 1024;

/// The CAPTCHA route's state.
pub(crate) struct CaptchaGateway<Solver> {
    access: BrainAccess,
    solves: Arc<Solves<Solver>>,
}

impl<Solver: CaptchaSolver> CaptchaGateway<Solver> {
    /// `solver` is `None` when no vendor key is configured: every solve
    /// answers `notConfigured`.
    pub(crate) fn new(
        access: BrainAccess,
        solver: Option<Solver>,
        recorder: Arc<dyn ai_usage::UsageRecorder>,
        limits: SolveLimits,
    ) -> Self {
        Self {
            access,
            solves: Arc::new(Solves::new(solver, recorder, limits)),
        }
    }
}

/// The CAPTCHA route, merged into the egress gateway router.
pub(crate) fn router<Solver: CaptchaSolver>(gateway: CaptchaGateway<Solver>) -> Router {
    Router::new()
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
        agent.user.id = Empty,
        agent.team.id = Empty,
        http.response.status_code = Empty,
        otel.status_code = Empty,
    );
    let refused = |status: StatusCode, outcome: &'static str, message: &'static str| {
        span.record("captcha.outcome", outcome);
        span.record("http.response.status_code", i64::from(status.as_u16()));
        if status.is_server_error() {
            span.record("otel.status_code", "ERROR");
        }
        (status, Json(serde_json::json!({ "error": message }))).into_response()
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

    match gateway
        .solves
        .solve(&brain, request.solve_id, task, &span)
        .instrument(span.clone())
        .await
    {
        Ok(outcome) => {
            span.record("captcha.outcome", outcome.as_str());
            span.record("http.response.status_code", 200);
            Json(outcome).into_response()
        }
        Err(taken) => {
            span.record("captcha.outcome", "conflict");
            span.record("http.response.status_code", 409);
            (
                StatusCode::CONFLICT,
                Json(serde_json::json!({ "error": taken.to_string() })),
            )
                .into_response()
        }
    }
}
