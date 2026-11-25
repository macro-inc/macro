//! Solver runs: the budget an agent teammate's CAPTCHA run spends. Every
//! `/brain/fireworks` model call and every `/brain/captcha/solve` takes one
//! unit from a live run named by the `x-macro-solver-run` header, and every
//! count lives in Postgres ([`pg::PgSolverRuns`]), so the caps hold across
//! replicas and deploys.
//!
//! A run lives [`RunLimits::lifetime`] and allows
//! [`RunLimits::model_calls`] model calls, [`RunLimits::model_calls_in_flight`]
//! of them at once, and [`RunLimits::solves`] solves. An agent has at most
//! [`RunLimits::concurrent`] unexpired runs and starts at most
//! [`RunLimits::hourly`] an hour and [`RunLimits::daily`] a day, so the
//! per-run call cap is also the calls-per-hour bound (runs an hour × calls a
//! run). A run ends when its tool ends it (`POST /brain/captcha/runs/{id}/end`)
//! or its last solve finishes; expiry is only the backstop for a run whose
//! process died.

use std::sync::Arc;
use std::time::Duration;

use ai_usage::UsageTracking;
use ai_usage::financial::{FinalizeInvocation, InvocationId};
use async_trait::async_trait;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::captcha_gateway::SolveOutcome;

pub(crate) mod pg;

#[cfg(test)]
pub(crate) mod test;

/// The header naming the run a call or solve spends.
pub(crate) const SOLVER_RUN_HEADER: &str = "x-macro-solver-run";

/// The run named by [`SOLVER_RUN_HEADER`], if it is a UUID.
pub(crate) fn run_header(headers: &HeaderMap) -> Option<SolverRunId> {
    headers
        .get(SOLVER_RUN_HEADER)?
        .to_str()
        .ok()
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
        .map(SolverRunId)
}

/// A solver run's id, a UUIDv7.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub(crate) struct SolverRunId(pub(crate) Uuid);

/// A run's budget and the per-agent run caps.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RunLimits {
    pub(crate) lifetime: Duration,
    pub(crate) model_calls: u16,
    pub(crate) model_calls_in_flight: u16,
    pub(crate) solves: u16,
    pub(crate) concurrent: u16,
    pub(crate) hourly: u16,
    pub(crate) daily: u16,
}

impl Default for RunLimits {
    fn default() -> Self {
        Self {
            lifetime: Duration::from_secs(6 * 60),
            model_calls: 16,
            model_calls_in_flight: 2,
            solves: 2,
            concurrent: 1,
            hourly: 20,
            daily: 100,
        }
    }
}

/// The per-agent cap a refused run or solve hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BudgetLimit {
    Concurrent,
    Hourly,
    Daily,
}

/// What starting a run answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RunStart {
    Started {
        run_id: SolverRunId,
        expires_at: DateTime<Utc>,
    },
    BudgetExceeded(BudgetLimit),
}

/// Why a call or solve may not spend the run it named.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunRefusal {
    /// No run, an unknown one, or another agent's.
    Required,
    /// Past its lifetime.
    Expired,
    /// Ended early: by its tool, or when its last solve finished.
    Ended,
    /// Its model calls or solves are used up.
    Exhausted,
    /// [`RunLimits::model_calls_in_flight`] calls are already running.
    Busy,
}

impl RunRefusal {
    /// The refusal's wire `code`.
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Required => "solver_run_required",
            Self::Expired => "solver_run_expired",
            Self::Ended => "solver_run_ended",
            Self::Exhausted => "solver_run_exhausted",
            Self::Busy => "solver_run_busy",
        }
    }

    /// 403 for a run the caller can't use, 429 for one it used up.
    pub(crate) fn status(self) -> axum::http::StatusCode {
        match self {
            Self::Required | Self::Expired | Self::Ended => axum::http::StatusCode::FORBIDDEN,
            Self::Exhausted | Self::Busy => axum::http::StatusCode::TOO_MANY_REQUESTS,
        }
    }

    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Required => "start a solver run and send its runId as x-macro-solver-run",
            Self::Expired => "the solver run has expired; start another",
            Self::Ended => "the solver run has ended; start another",
            Self::Exhausted => "the solver run has used up its budget",
            Self::Busy => "too many model calls of this solver run are running",
        }
    }
}

/// The solver-run store failed; the caller may retry.
#[derive(Debug, thiserror::Error)]
#[error("the solver-run store failed: {0}")]
pub(crate) struct LedgerError(#[from] pub(crate) sqlx::Error);

/// Runs and their model calls. `async_trait` so the gateways hold it as
/// `Arc<dyn SolverRuns>`.
#[async_trait]
pub(crate) trait SolverRuns: Send + Sync {
    /// Start a run for `agent`, unless a per-agent cap refuses it.
    async fn start(&self, agent: &MacroUserIdStr<'static>) -> Result<RunStart, LedgerError>;

    /// Take one model call from `run`, which must be `agent`'s, live, and
    /// have a call and an in-flight slot left.
    async fn take_model_call(
        &self,
        run: SolverRunId,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<Result<(), RunRefusal>, LedgerError>;

    /// End `agent`'s `run`: it is spent, and no longer counts as live. Ending
    /// one that is over already, or isn't the agent's, changes nothing.
    async fn end(
        &self,
        run: SolverRunId,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<(), LedgerError>;

    /// Give back the in-flight slot of a finished model call.
    async fn release_model_call(&self, run: SolverRunId) -> Result<(), LedgerError>;
}

/// The per-agent solve caps a new solve is counted against.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SolveCaps {
    pub(crate) concurrent: u8,
    pub(crate) hourly: u16,
    pub(crate) daily: u16,
    /// An unfinished solve older than this died with its process: it no
    /// longer counts as in flight, and its `solveId` replays `vendorError`.
    pub(crate) abandoned_after: Duration,
}

/// A solve to claim under its `solveId`.
#[derive(Debug, Clone)]
pub(crate) struct SolveClaim {
    pub(crate) solve_id: Uuid,
    pub(crate) run: SolverRunId,
    pub(crate) agent: MacroUserIdStr<'static>,
    pub(crate) caps: SolveCaps,
    /// The vendor blocked our key: a new solve is refused, a known one
    /// still replays.
    pub(crate) key_blocked: bool,
}

/// What claiming a solve answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Claimed {
    /// Recorded as in flight and taken from the run: send it to the vendor.
    New,
    /// This agent's `solveId` finished before: replay its answer.
    Finished(SolveOutcome),
    /// This agent's `solveId` is still being solved.
    InProgress,
    /// Another agent used this `solveId`.
    OtherAgent,
    BudgetExceeded(BudgetLimit),
    KeyBlocked,
    Refused(RunRefusal),
}

/// The solves ledger: idempotency and the per-agent solve caps. `async_trait`
/// so the gateway holds it as `Arc<dyn SolveLedger>`.
#[async_trait]
pub(crate) trait SolveLedger: Send + Sync {
    /// Look up `claim.solve_id`, or record it as a new solve taken from its
    /// run, all under one per-agent lock.
    async fn claim(&self, claim: &SolveClaim) -> Result<Claimed, LedgerError>;

    /// Record a solve's answer and CapSolver task. When it was its run's last
    /// solve and none of the run's solves is still running, the run ends.
    async fn finish(
        &self,
        solve_id: Uuid,
        outcome: &SolveOutcome,
        task_id: Option<&str>,
    ) -> Result<(), LedgerError>;
}

/// Deliver one observation to the `ai_usage` tracking journal: `begin` then
/// `finalize`, three tries. Observations never deny or alter the call they
/// describe, so a failure is logged, not returned.
pub(crate) async fn track(
    tracking: Arc<dyn UsageTracking>,
    invocation: ai_usage::TrackedInvocation,
    evidence: FinalizeInvocation,
) {
    let id: InvocationId = invocation.invocation_id;
    for _ in 0..3 {
        let delivered = match tracking.begin(invocation.clone()).await {
            Ok(_) => tracking.finalize(evidence.clone()).await,
            Err(error) => Err(error),
        };
        match delivered {
            Ok(_) => return,
            Err(error) => {
                tracing::error!(error = ?error, invocation_id = ?id, "usage observation delivery failed");
            }
        }
    }
}
