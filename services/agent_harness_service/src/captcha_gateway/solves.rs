//! Solving one CAPTCHA for an agent teammate: the challenge it may ask
//! about, the [`CaptchaSolver`] port, and [`Solves`], which takes each solve
//! from its solver run, records it under its `solveId` in the solves ledger
//! (idempotency and the per-agent caps, shared by every replica), polls the
//! vendor and bills a solved task.

use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use ai_usage::financial::{
    FinalizeInvocation, InvocationId, ProviderModel, ProviderOutcome, ProviderRequestId, RunId,
    UnresolvedReason, UsageEvidence,
};
use ai_usage::{AiFeature, TrackedInvocation, UsageContext, UsageRecorder};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use tracing::{Instrument, Span};
use uuid::Uuid;

use crate::anthropic_gateway::brain::BrainCaller;
use crate::solver_runs::{
    self, BudgetLimit, Claimed, LedgerError, RunRefusal, SolveCaps, SolveClaim, SolveLedger,
    SolverRunId,
};

/// How long CapSolver blocks a key after a burst of errors; no task is sent
/// in that time.
const KEY_BLOCKED_FOR: Duration = Duration::from_secs(5 * 60);
/// How much longer than `max_wait` an unfinished solve is still in flight;
/// past that its process died.
const ABANDONED_GRACE: Duration = Duration::from_secs(60);
/// The tracking journal's provider name for CapSolver tasks.
const CAPSOLVER_PROVIDER: &str = "capsolver";
/// Longest site key, action, cdata or `s` value accepted.
const MAX_FIELD_CHARS: usize = 4096;

/// A challenge on the agent's current page, as the caller read it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Challenge {
    /// reCAPTCHA v2, checkbox or invisible.
    RecaptchaV2 {
        page_url: String,
        site_key: String,
        #[serde(default)]
        invisible: bool,
        #[serde(default)]
        enterprise: bool,
        /// The anchor request's `s` value.
        data_s: Option<String>,
        /// The anchor request's `sa` value.
        action: Option<String>,
    },
    /// reCAPTCHA v3.
    RecaptchaV3 {
        page_url: String,
        site_key: String,
        action: Option<String>,
        #[serde(default)]
        enterprise: bool,
    },
    /// Cloudflare Turnstile (the widget, not the Challenge interstitial).
    Turnstile {
        page_url: String,
        site_key: String,
        action: Option<String>,
        cdata: Option<String>,
    },
}

/// The CapSolver task type a challenge is solved with; proxyless only. Its
/// string form is CapSolver's task type name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub(crate) enum TaskType {
    #[strum(serialize = "ReCaptchaV2TaskProxyLess")]
    ReCaptchaV2,
    #[strum(serialize = "ReCaptchaV2EnterpriseTaskProxyLess")]
    ReCaptchaV2Enterprise,
    #[strum(serialize = "ReCaptchaV3TaskProxyLess")]
    ReCaptchaV3,
    #[strum(serialize = "ReCaptchaV3EnterpriseTaskProxyLess")]
    ReCaptchaV3Enterprise,
    #[strum(serialize = "AntiTurnstileTaskProxyLess")]
    Turnstile,
}

impl TaskType {
    /// The `ai_pricing` row a solved task is billed at.
    pub(crate) fn pricing_model(self) -> &'static str {
        match self {
            Self::ReCaptchaV2 => "capsolver-recaptcha-v2",
            Self::ReCaptchaV2Enterprise => "capsolver-recaptcha-v2-enterprise",
            Self::ReCaptchaV3 => "capsolver-recaptcha-v3",
            Self::ReCaptchaV3Enterprise => "capsolver-recaptcha-v3-enterprise",
            Self::Turnstile => "capsolver-turnstile",
        }
    }
}

/// A challenge checked for sending: its page reduced to scheme, host and
/// path, and its fields bounded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CaptchaTask {
    pub(crate) challenge: Challenge,
    pub(crate) task_type: TaskType,
    /// The page's host, the only part of it telemetry records.
    pub(crate) host: String,
}

/// Why a challenge can't be sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub(crate) enum InvalidChallenge {
    #[error("pageUrl must be an absolute http(s) URL")]
    PageUrl,
    #[error("siteKey must be set")]
    SiteKey,
    #[error("a challenge field is longer than {MAX_FIELD_CHARS} characters")]
    TooLong,
}

impl CaptchaTask {
    pub(crate) fn new(mut challenge: Challenge) -> Result<Self, InvalidChallenge> {
        let (task_type, page_url, site_key, extras) = match &mut challenge {
            Challenge::RecaptchaV2 {
                page_url,
                site_key,
                enterprise,
                data_s,
                action,
                ..
            } => {
                let task_type = if *enterprise {
                    TaskType::ReCaptchaV2Enterprise
                } else {
                    TaskType::ReCaptchaV2
                };
                (
                    task_type,
                    page_url,
                    site_key,
                    [data_s.as_deref(), action.as_deref()],
                )
            }
            Challenge::RecaptchaV3 {
                page_url,
                site_key,
                action,
                enterprise,
            } => {
                let task_type = if *enterprise {
                    TaskType::ReCaptchaV3Enterprise
                } else {
                    TaskType::ReCaptchaV3
                };
                (task_type, page_url, site_key, [action.as_deref(), None])
            }
            Challenge::Turnstile {
                page_url,
                site_key,
                action,
                cdata,
            } => (
                TaskType::Turnstile,
                page_url,
                site_key,
                [action.as_deref(), cdata.as_deref()],
            ),
        };

        if site_key.trim().is_empty() {
            return Err(InvalidChallenge::SiteKey);
        }
        let too_long = |value: &str| value.chars().count() > MAX_FIELD_CHARS;
        if too_long(site_key.as_str()) || extras.into_iter().flatten().any(too_long) {
            return Err(InvalidChallenge::TooLong);
        }

        // CapSolver needs the page, not what the agent was doing on it:
        // query, fragment and any credentials stay here.
        let mut url = url::Url::parse(page_url.as_str()).map_err(|_| InvalidChallenge::PageUrl)?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(InvalidChallenge::PageUrl);
        }
        let host = url.host_str().ok_or(InvalidChallenge::PageUrl)?.to_owned();
        url.set_query(None);
        url.set_fragment(None);
        url.set_username("")
            .map_err(|_| InvalidChallenge::PageUrl)?;
        url.set_password(None)
            .map_err(|_| InvalidChallenge::PageUrl)?;
        *page_url = url.into();

        Ok(Self {
            challenge,
            task_type,
            host,
        })
    }
}

/// A CAPTCHA token. Its `Debug` never shows it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct CaptchaToken(String);

impl CaptchaToken {
    pub(crate) fn new(token: String) -> Self {
        Self(token)
    }
}

impl std::fmt::Debug for CaptchaToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CaptchaToken(..)")
    }
}

/// CapSolver's id for a created task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct TaskId(String);

impl TaskId {
    pub(crate) fn new(id: String) -> Self {
        Self(id)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// A solved task's answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Solution {
    pub(crate) token: CaptchaToken,
    pub(crate) user_agent: Option<String>,
}

/// What `createTask` answered.
#[derive(Debug)]
pub(crate) enum Created {
    /// Poll this task for its result.
    Pending(TaskId),
    /// Solved at once.
    Ready(TaskId, Solution),
}

/// What one `getTaskResult` answered.
#[derive(Debug)]
pub(crate) enum Polled {
    Pending,
    Ready(Solution),
}

/// A vendor error, by what the caller can do about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VendorErrorKind {
    RateLimited,
    OutOfBalance,
    Unavailable,
    KeyBlocked,
    InvalidTask,
    Unsupported,
}

/// Why a task did not come back solved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SolverError {
    /// The vendor could not solve it; nothing is charged.
    Unsolvable,
    /// The vendor gave up on it.
    TimedOut,
    Vendor(VendorErrorKind),
}

/// A CAPTCHA-solving vendor's task API.
pub(crate) trait CaptchaSolver: Send + Sync + 'static {
    /// Send the task; it is charged only if it comes back solved.
    fn create_task(
        &self,
        task: &CaptchaTask,
    ) -> impl Future<Output = Result<Created, SolverError>> + Send;

    /// The task's state now.
    fn task_result(
        &self,
        task_id: &TaskId,
    ) -> impl Future<Output = Result<Polled, SolverError>> + Send;
}

/// What `/brain/captcha/solve` answers; a finished one is stored as JSON
/// and replayed for a repeated `solveId`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SolveOutcome {
    Solved {
        token: CaptchaToken,
        user_agent: Option<String>,
        task_id: TaskId,
    },
    Unsolvable,
    Timeout,
    BudgetExceeded {
        limit: BudgetLimit,
    },
    VendorError {
        kind: VendorErrorKind,
    },
    NotConfigured,
}

/// What the solves ledger keeps of a finished solve: its outcome without a
/// solved token (or the user agent that goes with it). The token exists only
/// in the one answer that carries it, so nothing needs to expire it later.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum KeptOutcome {
    Solved { task_id: TaskId },
    Unsolvable,
    Timeout,
    BudgetExceeded { limit: BudgetLimit },
    VendorError { kind: VendorErrorKind },
    NotConfigured,
}

impl From<&SolveOutcome> for KeptOutcome {
    fn from(outcome: &SolveOutcome) -> Self {
        match outcome {
            SolveOutcome::Solved { task_id, .. } => Self::Solved {
                task_id: task_id.clone(),
            },
            SolveOutcome::Unsolvable => Self::Unsolvable,
            SolveOutcome::Timeout => Self::Timeout,
            SolveOutcome::BudgetExceeded { limit } => Self::BudgetExceeded { limit: *limit },
            SolveOutcome::VendorError { kind } => Self::VendorError { kind: *kind },
            SolveOutcome::NotConfigured => Self::NotConfigured,
        }
    }
}

impl KeptOutcome {
    /// What a repeated `solveId` answers. A solved one's token is gone, and
    /// it was short-lived anyway: it answers `timeout`, so the caller solves
    /// again (no second task was created or charged for the repeat).
    pub(crate) fn replayed(self) -> SolveOutcome {
        match self {
            Self::Solved { .. } | Self::Timeout => SolveOutcome::Timeout,
            Self::Unsolvable => SolveOutcome::Unsolvable,
            Self::BudgetExceeded { limit } => SolveOutcome::BudgetExceeded { limit },
            Self::VendorError { kind } => SolveOutcome::VendorError { kind },
            Self::NotConfigured => SolveOutcome::NotConfigured,
        }
    }
}

impl SolveOutcome {
    /// The span's `captcha.outcome`.
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Solved { .. } => "solved",
            Self::Unsolvable => "unsolvable",
            Self::Timeout => "timeout",
            Self::BudgetExceeded { .. } => "budget_exceeded",
            Self::VendorError { .. } => "vendor_error",
            Self::NotConfigured => "not_configured",
        }
    }
}

impl From<SolverError> for SolveOutcome {
    fn from(error: SolverError) -> Self {
        match error {
            SolverError::Unsolvable => Self::Unsolvable,
            SolverError::TimedOut => Self::Timeout,
            SolverError::Vendor(kind) => Self::VendorError { kind },
        }
    }
}

/// Why a solve was refused without an outcome.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SolveRefused {
    #[error("this solveId belongs to another agent")]
    OtherAgent,
    #[error("this solveId is still being solved")]
    InProgress,
    #[error("{}", .0.message())]
    Run(RunRefusal),
    #[error(transparent)]
    Ledger(#[from] LedgerError),
}

/// Per-agent caps and the polling schedule. Every cap counts the solves
/// ledger, so it holds across replicas.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SolveLimits {
    pub(crate) concurrent: u8,
    pub(crate) hourly: u16,
    pub(crate) daily: u16,
    pub(crate) poll_interval: Duration,
    pub(crate) max_wait: Duration,
    /// Whether a solved task is charged to the agent's user. Off: CapSolver's
    /// terms forbid reselling its service without its written approval, so
    /// until then Macro absorbs the cost and every solve is only observed in
    /// the tracking journal (with CapSolver's task id).
    pub(crate) charge_users: bool,
}

impl Default for SolveLimits {
    fn default() -> Self {
        Self {
            concurrent: 1,
            hourly: 20,
            daily: 100,
            poll_interval: Duration::from_secs(2),
            max_wait: Duration::from_secs(120),
            charge_users: false,
        }
    }
}

impl SolveLimits {
    fn caps(self) -> SolveCaps {
        SolveCaps {
            concurrent: self.concurrent,
            hourly: self.hourly,
            daily: self.daily,
            abandoned_after: self.max_wait + ABANDONED_GRACE,
        }
    }
}

/// Solves challenges for agents, once per `solveId`.
pub(crate) struct Solves<Solver> {
    /// `None` when no vendor key is configured: every solve is
    /// [`SolveOutcome::NotConfigured`].
    solver: Option<Arc<Solver>>,
    ledger: Arc<dyn SolveLedger>,
    recorder: Arc<dyn UsageRecorder>,
    limits: SolveLimits,
    /// The vendor blocked our key; no task goes out before this. Per
    /// process: it saves vendor calls, it guards no budget.
    key_blocked_until: Arc<Mutex<Option<Instant>>>,
    /// Where the solves run, so shutdown waits for the ones under way.
    tasks: tokio_util::task::TaskTracker,
}

impl<Solver: CaptchaSolver> Solves<Solver> {
    pub(crate) fn new(
        solver: Option<Solver>,
        ledger: Arc<dyn SolveLedger>,
        recorder: Arc<dyn UsageRecorder>,
        limits: SolveLimits,
        tasks: tokio_util::task::TaskTracker,
    ) -> Self {
        Self {
            solver: solver.map(Arc::new),
            ledger,
            recorder,
            limits,
            key_blocked_until: Arc::new(Mutex::new(None)),
            tasks,
        }
    }

    pub(crate) fn configured(&self) -> bool {
        self.solver.is_some()
    }

    /// Solve `task` for `agent` on `run`, or answer what the first request
    /// with this `solve_id` got. The vendor work runs on its own task, so a
    /// caller that hangs up neither cancels a solve nor skips its usage.
    /// Refusals (no key, a cap, a blocked key) are not recorded: a retry may
    /// pass.
    pub(crate) async fn solve(
        &self,
        agent: &BrainCaller,
        run: SolverRunId,
        solve_id: Uuid,
        task: CaptchaTask,
        span: &Span,
    ) -> Result<SolveOutcome, SolveRefused> {
        let Some(solver) = self.solver.clone() else {
            return Ok(SolveOutcome::NotConfigured);
        };
        let key_blocked = self
            .key_blocked_until
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some_and(|until| Instant::now() < until);
        let claim = SolveClaim {
            solve_id,
            run,
            agent: agent.user_id.clone(),
            caps: self.limits.caps(),
            key_blocked,
        };

        // Claimed, solved, recorded and billed on its own task, so a caller
        // that hangs up never leaves a claimed solve behind.
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let ledger = Arc::clone(&self.ledger);
        let recorder = Arc::clone(&self.recorder);
        let limits = self.limits;
        let solve_span = span.clone();
        let blocked_until = Arc::clone(&self.key_blocked_until);
        self.tasks.spawn(
            async move {
                let answer = match ledger.claim(&claim).await {
                    Err(error) => Err(SolveRefused::Ledger(error)),
                    Ok(Claimed::New) => {
                        let (outcome, task_id) =
                            run_task(solver.as_ref(), &task, limits, &solve_span).await;
                        if outcome
                            == (SolveOutcome::VendorError {
                                kind: VendorErrorKind::KeyBlocked,
                            })
                        {
                            *blocked_until.lock().unwrap_or_else(PoisonError::into_inner) =
                                Some(Instant::now() + KEY_BLOCKED_FOR);
                        }
                        let _ = ledger
                            .finish(solve_id, &outcome, task_id.as_ref().map(TaskId::as_str))
                            .await
                            .inspect_err(|error| {
                                tracing::error!(error = ?error, "the solve's outcome was not recorded");
                            });
                        bill(recorder, limits.charge_users, &claim.agent, run, &task, &outcome)
                            .await;
                        Ok(outcome)
                    }
                    Ok(Claimed::Finished(outcome)) => Ok(outcome),
                    Ok(Claimed::InProgress) => Err(SolveRefused::InProgress),
                    Ok(Claimed::OtherAgent) => Err(SolveRefused::OtherAgent),
                    Ok(Claimed::BudgetExceeded(limit)) => {
                        Ok(SolveOutcome::BudgetExceeded { limit })
                    }
                    Ok(Claimed::KeyBlocked) => Ok(SolveOutcome::VendorError {
                        kind: VendorErrorKind::KeyBlocked,
                    }),
                    Ok(Claimed::Refused(refusal)) => Err(SolveRefused::Run(refusal)),
                };
                let _ = sender.send(answer);
            }
            .instrument(span.clone()),
        );
        // The solve's task always sends an answer; a dropped sender means it
        // died, which the caller sees as the vendor being unavailable.
        receiver.await.unwrap_or(Ok(SolveOutcome::VendorError {
            kind: VendorErrorKind::Unavailable,
        }))
    }
}

/// Observe a solved task (CapSolver charges only those) in the tracking
/// journal under its run with CapSolver's task id, and, when `charge_users`
/// is on, charge it on the legacy recorder, which settles it. The journal has
/// no credit dimension, so its usage is `UnsupportedDimensions`: any charge
/// is the recorder's alone.
async fn bill(
    recorder: Arc<dyn UsageRecorder>,
    charge_users: bool,
    agent: &MacroUserIdStr<'static>,
    run: SolverRunId,
    task: &CaptchaTask,
    outcome: &SolveOutcome,
) {
    let SolveOutcome::Solved { task_id, .. } = outcome else {
        return;
    };
    if charge_users {
        recorder.record(
            UsageContext::new(AiFeature::AgentSession, agent.clone())
                .into_provider_credits_event(task.task_type.pricing_model().to_owned(), 1),
        );
    }
    let Some(tracking) = recorder.tracking() else {
        return;
    };
    let (Ok(run_id), Ok(model)) = (
        RunId::try_from(run.0),
        ProviderModel::new(CAPSOLVER_PROVIDER, <&'static str>::from(task.task_type)),
    ) else {
        tracing::error!("the solve cannot be identified for tracking");
        return;
    };
    let invocation = TrackedInvocation {
        run_id,
        invocation_id: InvocationId::new(),
        user: agent.clone(),
        feature: AiFeature::AgentSession,
        entity: None,
        model,
        occurred_at: Utc::now(),
    };
    let evidence = FinalizeInvocation {
        invocation_id: invocation.invocation_id,
        occurred_at: Utc::now(),
        provider_request_id: ProviderRequestId::new(task_id.as_str()).ok(),
        outcome: ProviderOutcome::Succeeded,
        usage: UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions),
    };
    solver_runs::track(tracking, invocation, evidence).await;
}

/// Create the task, then poll it every `poll_interval` until it is decided
/// or `max_wait` has passed since the start. A rate limit or an outage while
/// polling is waited out, not given up on: the task may still be solved, and
/// charged. Answers the vendor's task id when one was created.
async fn run_task<Solver: CaptchaSolver>(
    solver: &Solver,
    task: &CaptchaTask,
    limits: SolveLimits,
    span: &Span,
) -> (SolveOutcome, Option<TaskId>) {
    let deadline = Instant::now() + limits.max_wait;
    let task_id = match tokio::time::timeout_at(deadline, solver.create_task(task)).await {
        Err(_) => return (SolveOutcome::Timeout, None),
        Ok(Err(error)) => return (error.into(), None),
        Ok(Ok(Created::Ready(task_id, solution))) => {
            span.record("captcha.task_id", task_id.as_str());
            return (solved(task_id.clone(), solution), Some(task_id));
        }
        Ok(Ok(Created::Pending(task_id))) => task_id,
    };
    span.record("captcha.task_id", task_id.as_str());

    let mut polls: u32 = 0;
    loop {
        let next = Instant::now() + limits.poll_interval;
        if next >= deadline {
            span.record("captcha.polls", polls);
            return (SolveOutcome::Timeout, Some(task_id));
        }
        tokio::time::sleep_until(next).await;

        polls += 1;
        let polled = tokio::time::timeout_at(deadline, solver.task_result(&task_id)).await;
        span.record("captcha.polls", polls);
        match polled {
            Err(_) => return (SolveOutcome::Timeout, Some(task_id)),
            Ok(Ok(Polled::Pending)) => {}
            Ok(Ok(Polled::Ready(solution))) => {
                return (solved(task_id.clone(), solution), Some(task_id));
            }
            Ok(Err(SolverError::Vendor(
                VendorErrorKind::RateLimited | VendorErrorKind::Unavailable,
            ))) => {}
            Ok(Err(error)) => return (error.into(), Some(task_id)),
        }
    }
}

fn solved(task_id: TaskId, solution: Solution) -> SolveOutcome {
    SolveOutcome::Solved {
        token: solution.token,
        user_agent: solution.user_agent,
        task_id,
    }
}
