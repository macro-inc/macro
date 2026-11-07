//! One account's call budget for one MCP upstream.
//!
//! A program that `Promise.all`s a call per pull request sends hundreds of
//! calls at once, and an owner's scheduled routines start together, so the
//! upstream answers most of them with HTTP 429. Every exchange one account
//! makes with one upstream shares a lane here, across all of that account's
//! sessions and executions: a few in flight, starts spaced apart, and a
//! 429's `Retry-After` cools the whole lane down before anything in it is
//! sent again. A refused exchange is retried while its deadline allows
//! another start; one still refused then fails as
//! [`EgressError::RateLimited`], never as a result that looks like success.
//!
//! It wraps only the HTTP send: credential resolution and owner approvals
//! happen before a call reaches the transport, so nobody waiting on a person
//! holds a lane's permit, and a retry never asks for approval twice.
//!
//! Lanes live in this process's memory: replicas each keep their own, so the
//! budget an account gets grows with the replica count.

use crate::domain::{
    error::EgressError,
    model::{AgentSessionId, UpstreamCall},
    ports::ActorMcpTransport,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::Instant;
use tracing::Instrument;

#[cfg(test)]
mod test;

/// Lanes kept before idle ones are dropped.
const MAX_LANES: usize = 1024;

/// The longest cooldown one 429 can impose, whatever its `Retry-After` says.
const MAX_COOLDOWN: Duration = Duration::from_secs(60 * 60);

/// How hard one account may drive one connected app.
#[derive(Clone, Copy, Debug)]
pub struct BudgetPolicy {
    /// Most calls in flight at once.
    pub concurrency: usize,
    /// Least time between two calls starting.
    pub interval: Duration,
    /// After this long, a call gets no new attempt: it bounds when the last
    /// attempt may start, not how long that attempt then runs.
    pub deadline: Duration,
    /// The wait after a 429 that named none.
    pub default_retry_after: Duration,
    /// Most random time added to a cooldown, so replicas that each saw the
    /// 429 do not all resume in the same instant.
    pub max_jitter: Duration,
}

impl BudgetPolicy {
    /// Four calls at once, ten starts a second, and no new attempt after 25
    /// seconds, inside a code execution's 30-second lifetime.
    pub const DEFAULT: Self = Self {
        concurrency: 4,
        interval: Duration::from_millis(100),
        deadline: Duration::from_secs(25),
        default_retry_after: Duration::from_secs(1),
        max_jitter: Duration::from_millis(250),
    };
}

/// The calls that share a budget: one account's calls to one upstream.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct BudgetLane {
    /// The account whose quota the calls spend.
    pub account: MacroUserIdStr<'static>,
    /// The upstream's URL and the scope headers that name the app behind a
    /// shared endpoint (Pipedream's app slug), never its credential.
    pub upstream: String,
    /// The upstream's host, the only part recorded on spans.
    pub host: String,
}

impl BudgetLane {
    /// The lane `upstream`'s calls as `account` share.
    pub fn of(account: MacroUserIdStr<'static>, upstream: &UpstreamCall) -> Self {
        let mut key = upstream.url().to_string();
        for (name, value) in upstream.scope_headers() {
            key.push('\n');
            key.push_str(name.as_str());
            key.push(':');
            key.push_str(&String::from_utf8_lossy(value.as_bytes()));
        }
        Self {
            account,
            upstream: key,
            host: upstream.url().host_str().unwrap_or_default().to_owned(),
        }
    }
}

/// Paces connected-app calls per [`BudgetLane`].
pub struct CallBudget {
    policy: BudgetPolicy,
    lanes: Mutex<HashMap<BudgetLane, Arc<Lane>>>,
}

struct Lane {
    permits: Semaphore,
    schedule: Mutex<Schedule>,
}

#[derive(Default)]
struct Schedule {
    /// The earliest the next call may start.
    next_start: Option<Instant>,
    /// Nothing starts before this, after a 429.
    cooldown_until: Option<Instant>,
    /// When the last call was let through to the upstream.
    last_admitted: Option<Instant>,
}

impl Lane {
    fn schedule(&self) -> std::sync::MutexGuard<'_, Schedule> {
        self.schedule.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Reserve the next start, or `None` when it would fall after `deadline`.
    fn reserve(&self, interval: Duration, deadline: Instant) -> Option<Instant> {
        let mut schedule = self.schedule();
        let start = [schedule.next_start, schedule.cooldown_until]
            .into_iter()
            .flatten()
            .fold(Instant::now(), Instant::max);
        if start > deadline {
            return None;
        }
        schedule.next_start = Some(start + interval);
        Some(start)
    }

    /// Let a call through at `now`, unless the lane is cooling or another
    /// call went through less than `interval` ago: a timer wakes late, so
    /// two reserved slots can come due together.
    fn admit(&self, now: Instant, interval: Duration) -> bool {
        let mut schedule = self.schedule();
        let cooling = schedule.cooldown_until.is_some_and(|until| until > now);
        let too_soon = schedule
            .last_admitted
            .is_some_and(|admitted| now < admitted + interval);
        if cooling || too_soon {
            return false;
        }
        schedule.last_admitted = Some(now);
        let earliest = now + interval;
        schedule.next_start = Some(schedule.next_start.map_or(earliest, |at| at.max(earliest)));
        true
    }

    fn cool_down(&self, until: Instant) {
        let mut schedule = self.schedule();
        schedule.cooldown_until = Some(schedule.cooldown_until.map_or(until, |at| at.max(until)));
    }

    fn cooling(&self, now: Instant) -> bool {
        self.remaining_cooldown(now).is_some()
    }

    /// How long until the lane's cooldown ends, if it is cooling.
    fn remaining_cooldown(&self, now: Instant) -> Option<Duration> {
        self.schedule()
            .cooldown_until
            .filter(|until| *until > now)
            .map(|until| until - now)
    }
}

impl CallBudget {
    /// A budget with no lanes yet, every lane under `policy`.
    pub fn new(policy: BudgetPolicy) -> Self {
        Self {
            policy,
            lanes: Mutex::new(HashMap::new()),
        }
    }

    fn lane(&self, key: BudgetLane) -> Arc<Lane> {
        let mut lanes = self.lanes.lock().unwrap_or_else(PoisonError::into_inner);
        if lanes.len() >= MAX_LANES {
            let now = Instant::now();
            lanes.retain(|_, lane| Arc::strong_count(lane) > 1 || lane.cooling(now));
        }
        Arc::clone(lanes.entry(key).or_insert_with(|| {
            Arc::new(Lane {
                permits: Semaphore::new(self.policy.concurrency),
                schedule: Mutex::new(Schedule::default()),
            })
        }))
    }

    /// Run `call` within `lane`'s budget: wait for a slot, and after a 429
    /// wait out the lane's cooldown and call again, until the deadline.
    pub async fn run<T, Call, Attempt>(
        &self,
        lane: BudgetLane,
        mut call: Call,
    ) -> Result<T, EgressError>
    where
        Call: FnMut() -> Attempt,
        Attempt: Future<Output = Result<T, EgressError>>,
    {
        let span = tracing::info_span!(
            "mcp.call_budget",
            upstream_host = %lane.host,
            wait_ms = tracing::field::Empty,
            attempts = tracing::field::Empty,
            rate_limited = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let policy = self.policy;
        let lane = self.lane(lane);
        async move {
            let deadline = Instant::now() + policy.deadline;
            let mut waited = Duration::ZERO;
            let mut attempts = 0u32;
            let mut refusals = 0u32;
            let result = loop {
                let queued = Instant::now();
                let Ok(Ok(permit)) =
                    tokio::time::timeout_at(deadline, lane.permits.acquire()).await
                else {
                    waited += queued.elapsed();
                    break Err(exhausted(&lane));
                };
                let Some(start) = lane.reserve(policy.interval, deadline) else {
                    waited += queued.elapsed();
                    break Err(exhausted(&lane));
                };
                tokio::time::sleep_until(start).await;
                waited += queued.elapsed();
                let now = Instant::now();
                if now > deadline {
                    break Err(exhausted(&lane));
                }
                // A 429 that landed, or another call that went through,
                // while this one waited for its slot.
                if !lane.admit(now, policy.interval) {
                    continue;
                }
                attempts += 1;
                let outcome = call().await;
                drop(permit);
                match outcome {
                    Err(EgressError::RateLimited { retry_after: asked }) => {
                        refusals += 1;
                        let jitter = Duration::from_millis(rand::random_range(
                            0..=u64::try_from(policy.max_jitter.as_millis()).unwrap_or(u64::MAX),
                        ));
                        let wait = asked
                            .unwrap_or(policy.default_retry_after)
                            .min(MAX_COOLDOWN);
                        lane.cool_down(Instant::now() + wait + jitter);
                    }
                    outcome => break outcome,
                }
            };
            let span = tracing::Span::current();
            span.record(
                "wait_ms",
                u64::try_from(waited.as_millis()).unwrap_or(u64::MAX),
            );
            span.record("attempts", attempts);
            span.record("rate_limited", refusals);
            span.record(
                "outcome",
                match &result {
                    Ok(_) => "ok",
                    Err(EgressError::RateLimited { .. }) => "rate_limited",
                    Err(_) => "error",
                },
            );
            if matches!(result, Err(EgressError::RateLimited { .. })) {
                tracing::warn!(
                    attempts,
                    refusals,
                    "MCP upstream still rate limited at the deadline"
                );
            }
            result
        }
        .instrument(span)
        .await
    }
}

/// The failure of a call the lane could not get through by its deadline,
/// telling the caller how much of the lane's cooldown is left.
fn exhausted(lane: &Lane) -> EgressError {
    EgressError::RateLimited {
        retry_after: lane.remaining_cooldown(Instant::now()),
    }
}

/// An [`ActorMcpTransport`] whose tool calls run within [`CallBudget`].
pub struct BudgetedMcpTransport {
    inner: Arc<dyn ActorMcpTransport>,
    budget: CallBudget,
}

impl BudgetedMcpTransport {
    /// Pace `inner`'s tool calls under `policy`. Listings pass straight
    /// through: one per app, and never stuck behind a program's burst.
    pub fn new(inner: Arc<dyn ActorMcpTransport>, policy: BudgetPolicy) -> Self {
        Self {
            inner,
            budget: CallBudget::new(policy),
        }
    }
}

#[async_trait::async_trait]
impl ActorMcpTransport for BudgetedMcpTransport {
    async fn exchange(
        &self,
        session: AgentSessionId,
        actor: MacroUserIdStr<'static>,
        upstream: UpstreamCall,
        request: Value,
    ) -> Result<Value, EgressError> {
        if request["method"] != "tools/call" {
            return self.inner.exchange(session, actor, upstream, request).await;
        }
        let lane = BudgetLane::of(actor.clone(), &upstream);
        self.budget
            .run(lane, || {
                self.inner
                    .exchange(session, actor.clone(), upstream.clone(), request.clone())
            })
            .await
    }
}
