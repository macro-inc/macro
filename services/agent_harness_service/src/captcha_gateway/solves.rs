//! Solving one CAPTCHA for an agent teammate: the challenge it may ask
//! about, the [`CaptchaSolver`] port, and [`Solves`], which owns idempotency,
//! the per-agent limits, polling and usage.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tokio::time::Instant;
use tracing::{Instrument, Span};
use uuid::Uuid;

use crate::anthropic_gateway::brain::BrainCaller;

/// How long a finished solve is remembered for its `solveId`.
const REMEMBERED_FOR: Duration = Duration::from_secs(10 * 60);
/// The span window of the hourly limit.
const HOUR: Duration = Duration::from_secs(60 * 60);
/// The span window of the daily limit.
const DAY: Duration = Duration::from_secs(24 * 60 * 60);
/// How long CapSolver blocks a key after a burst of errors; no task is sent
/// in that time.
const KEY_BLOCKED_FOR: Duration = Duration::from_secs(5 * 60);
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

/// The CapSolver task type a challenge is solved with; proxyless only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub(crate) enum TaskType {
    ReCaptchaV2TaskProxyLess,
    ReCaptchaV2EnterpriseTaskProxyLess,
    ReCaptchaV3TaskProxyLess,
    ReCaptchaV3EnterpriseTaskProxyLess,
    AntiTurnstileTaskProxyLess,
}

impl TaskType {
    /// The `ai_pricing` row a solved task is billed at.
    pub(crate) fn pricing_model(self) -> &'static str {
        match self {
            Self::ReCaptchaV2TaskProxyLess => "capsolver-recaptcha-v2",
            Self::ReCaptchaV2EnterpriseTaskProxyLess => "capsolver-recaptcha-v2-enterprise",
            Self::ReCaptchaV3TaskProxyLess => "capsolver-recaptcha-v3",
            Self::ReCaptchaV3EnterpriseTaskProxyLess => "capsolver-recaptcha-v3-enterprise",
            Self::AntiTurnstileTaskProxyLess => "capsolver-turnstile",
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
                    TaskType::ReCaptchaV2EnterpriseTaskProxyLess
                } else {
                    TaskType::ReCaptchaV2TaskProxyLess
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
                    TaskType::ReCaptchaV3EnterpriseTaskProxyLess
                } else {
                    TaskType::ReCaptchaV3TaskProxyLess
                };
                (task_type, page_url, site_key, [action.as_deref(), None])
            }
            Challenge::Turnstile {
                page_url,
                site_key,
                action,
                cdata,
            } => (
                TaskType::AntiTurnstileTaskProxyLess,
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
#[derive(Clone, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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

/// The per-agent cap a refused solve hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BudgetLimit {
    Concurrent,
    Hourly,
    Daily,
}

/// What `/brain/captcha/solve` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

/// The same `solveId` was used by another agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("this solveId belongs to another agent")]
pub(crate) struct SolveIdTaken;

/// Per-agent caps and the polling schedule. Every cap is per process.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SolveLimits {
    pub(crate) concurrent: u8,
    pub(crate) hourly: u16,
    pub(crate) daily: u16,
    pub(crate) poll_interval: Duration,
    pub(crate) max_wait: Duration,
}

impl Default for SolveLimits {
    fn default() -> Self {
        Self {
            concurrent: 1,
            hourly: 20,
            daily: 100,
            poll_interval: Duration::from_secs(2),
            max_wait: Duration::from_secs(120),
        }
    }
}

/// A solve under its `solveId`: in flight while `outcome` holds `None`.
struct Remembered {
    agent: MacroUserIdStr<'static>,
    started: Instant,
    outcome: watch::Receiver<Option<SolveOutcome>>,
}

/// One agent's use of the solver.
#[derive(Default)]
struct AgentUse {
    in_flight: u8,
    /// When each solve that reached the vendor started, oldest first.
    starts: VecDeque<Instant>,
}

#[derive(Default)]
struct SolveState {
    solves: HashMap<Uuid, Remembered>,
    agents: HashMap<MacroUserIdStr<'static>, AgentUse>,
    /// The vendor blocked our key; no task goes out before this.
    key_blocked_until: Option<Instant>,
}

/// Solves challenges for agents, once per `solveId`.
pub(crate) struct Solves<Solver> {
    /// `None` when no vendor key is configured: every solve is
    /// [`SolveOutcome::NotConfigured`].
    solver: Option<Arc<Solver>>,
    recorder: Arc<dyn UsageRecorder>,
    limits: SolveLimits,
    state: Mutex<SolveState>,
}

impl<Solver: CaptchaSolver> Solves<Solver> {
    pub(crate) fn new(
        solver: Option<Solver>,
        recorder: Arc<dyn UsageRecorder>,
        limits: SolveLimits,
    ) -> Self {
        Self {
            solver: solver.map(Arc::new),
            recorder,
            limits,
            state: Mutex::new(SolveState::default()),
        }
    }

    /// Solve `task` for `agent`, or answer what the first request with this
    /// `solve_id` got. The vendor work runs on its own task, so a caller that
    /// hangs up neither cancels a solve nor skips its usage. Refusals (no
    /// key, a cap, a blocked key) are not remembered: a retry may pass.
    pub(crate) async fn solve(
        self: &Arc<Self>,
        agent: &BrainCaller,
        solve_id: Uuid,
        task: CaptchaTask,
        span: &Span,
    ) -> Result<SolveOutcome, SolveIdTaken> {
        let mut outcome = match self.admit(agent, solve_id, &task, span)? {
            Admitted::Refused(outcome) => return Ok(outcome),
            Admitted::Waiting(outcome) => outcome,
        };

        let finished = outcome
            .wait_for(Option::is_some)
            .await
            .ok()
            .and_then(|outcome| outcome.clone());
        // The solve's task always sends an outcome; a dropped sender means it
        // died, which the caller sees as the vendor being unavailable.
        Ok(finished.unwrap_or(SolveOutcome::VendorError {
            kind: VendorErrorKind::Unavailable,
        }))
    }

    /// Join a remembered solve, refuse, or start a new one.
    fn admit(
        self: &Arc<Self>,
        agent: &BrainCaller,
        solve_id: Uuid,
        task: &CaptchaTask,
        span: &Span,
    ) -> Result<Admitted, SolveIdTaken> {
        let now = Instant::now();
        let mut state = self.state();
        state
            .solves
            .retain(|_, solve| now.duration_since(solve.started) < REMEMBERED_FOR);
        if let Some(solve) = state.solves.get(&solve_id) {
            if solve.agent != agent.user_id {
                return Err(SolveIdTaken);
            }
            return Ok(Admitted::Waiting(solve.outcome.clone()));
        }

        let Some(solver) = self.solver.clone() else {
            return Ok(Admitted::Refused(SolveOutcome::NotConfigured));
        };
        if state.key_blocked_until.is_some_and(|until| now < until) {
            return Ok(Admitted::Refused(SolveOutcome::VendorError {
                kind: VendorErrorKind::KeyBlocked,
            }));
        }
        let limits = self.limits;
        let usage = state.agents.entry(agent.user_id.clone()).or_default();
        while usage
            .starts
            .front()
            .is_some_and(|start| now.duration_since(*start) >= DAY)
        {
            usage.starts.pop_front();
        }
        let last_hour = usage
            .starts
            .iter()
            .filter(|start| now.duration_since(**start) < HOUR)
            .count();
        let limit = if usage.in_flight >= limits.concurrent {
            Some(BudgetLimit::Concurrent)
        } else if last_hour >= usize::from(limits.hourly) {
            Some(BudgetLimit::Hourly)
        } else if usage.starts.len() >= usize::from(limits.daily) {
            Some(BudgetLimit::Daily)
        } else {
            None
        };
        if let Some(limit) = limit {
            return Ok(Admitted::Refused(SolveOutcome::BudgetExceeded { limit }));
        }

        usage.in_flight += 1;
        usage.starts.push_back(now);
        let (sender, receiver) = watch::channel(None);
        state.solves.insert(
            solve_id,
            Remembered {
                agent: agent.user_id.clone(),
                started: now,
                outcome: receiver.clone(),
            },
        );
        drop(state);

        let solves = Arc::clone(self);
        let agent = agent.user_id.clone();
        let task = task.clone();
        let solve_span = span.clone();
        tokio::spawn(
            async move {
                let outcome = run(solver.as_ref(), &task, limits, &solve_span).await;
                solves.finish(&agent, &task, &outcome);
                let _ = sender.send(Some(outcome));
            }
            .instrument(span.clone()),
        );
        Ok(Admitted::Waiting(receiver))
    }

    /// Release the agent's slot and bill a solved task.
    fn finish(&self, agent: &MacroUserIdStr<'static>, task: &CaptchaTask, outcome: &SolveOutcome) {
        {
            let mut state = self.state();
            if let Some(usage) = state.agents.get_mut(agent) {
                usage.in_flight = usage.in_flight.saturating_sub(1);
            }
            if *outcome
                == (SolveOutcome::VendorError {
                    kind: VendorErrorKind::KeyBlocked,
                })
            {
                state.key_blocked_until = Some(Instant::now() + KEY_BLOCKED_FOR);
            }
        }

        // CapSolver charges only for a solved task.
        if let SolveOutcome::Solved { .. } = outcome {
            self.recorder.record(
                UsageContext::new(AiFeature::AgentSession, agent.clone())
                    .into_provider_credits_event(task.task_type.pricing_model().to_owned(), 1),
            );
        }
    }

    fn state(&self) -> MutexGuard<'_, SolveState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

enum Admitted {
    Refused(SolveOutcome),
    Waiting(watch::Receiver<Option<SolveOutcome>>),
}

/// Create the task, then poll it every `poll_interval` until it is decided
/// or `max_wait` has passed since the start. A rate limit or an outage while
/// polling is waited out, not given up on: the task may still be solved, and
/// charged.
async fn run<Solver: CaptchaSolver>(
    solver: &Solver,
    task: &CaptchaTask,
    limits: SolveLimits,
    span: &Span,
) -> SolveOutcome {
    let deadline = Instant::now() + limits.max_wait;
    let task_id = match tokio::time::timeout_at(deadline, solver.create_task(task)).await {
        Err(_) => return SolveOutcome::Timeout,
        Ok(Err(error)) => return error.into(),
        Ok(Ok(Created::Ready(task_id, solution))) => {
            span.record("captcha.task_id", task_id.as_str());
            return solved(task_id, solution);
        }
        Ok(Ok(Created::Pending(task_id))) => task_id,
    };
    span.record("captcha.task_id", task_id.as_str());

    let mut polls: u32 = 0;
    loop {
        let next = Instant::now() + limits.poll_interval;
        if next >= deadline {
            span.record("captcha.polls", polls);
            return SolveOutcome::Timeout;
        }
        tokio::time::sleep_until(next).await;

        polls += 1;
        let polled = tokio::time::timeout_at(deadline, solver.task_result(&task_id)).await;
        span.record("captcha.polls", polls);
        match polled {
            Err(_) => return SolveOutcome::Timeout,
            Ok(Ok(Polled::Pending)) => {}
            Ok(Ok(Polled::Ready(solution))) => return solved(task_id, solution),
            Ok(Err(SolverError::Vendor(
                VendorErrorKind::RateLimited | VendorErrorKind::Unavailable,
            ))) => {}
            Ok(Err(error)) => return error.into(),
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
