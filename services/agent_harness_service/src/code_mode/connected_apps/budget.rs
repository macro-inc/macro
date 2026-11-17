//! One account's call budget for one connected app.
//!
//! A program that `Promise.all`s a call per pull request sends hundreds of
//! calls at once, and an owner's scheduled routines start together, so the
//! upstream answers most of them with HTTP 429. Every call one account makes
//! to one app shares a lane here, across all of that account's running
//! programs: a few calls in flight, starts spaced apart, and a 429's
//! `Retry-After` cools the whole lane down before anything in it is sent
//! again. A refused call is retried until its deadline; one still refused
//! then fails as rate limited, never as a result that looks like success.
//!
//! Lanes live in this harness instance's memory: replicas each keep their
//! own, so the budget an account gets grows with the replica count.

use agent_code_mode::domain::connected_apps::ConnectedAppRef;
use agent_egress::domain::error::EgressError;
use macro_user_id::user_id::MacroUserIdStr;
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

/// How hard one account may drive one connected app.
#[derive(Clone, Copy, Debug)]
pub struct BudgetPolicy {
    /// Most calls in flight at once.
    pub concurrency: usize,
    /// Least time between two calls starting.
    pub interval: Duration,
    /// Longest one call may wait, retries included.
    pub deadline: Duration,
    /// The wait after a 429 that named none.
    pub default_retry_after: Duration,
    /// Most random time added to a cooldown, so waiting calls do not all
    /// retry in the same instant.
    pub max_jitter: Duration,
}

impl BudgetPolicy {
    /// Four calls at once, ten starts a second, and 25 seconds to get one
    /// through, inside an execution's 30-second lifetime.
    pub const DEFAULT: Self = Self {
        concurrency: 4,
        interval: Duration::from_millis(100),
        deadline: Duration::from_secs(25),
        default_retry_after: Duration::from_secs(1),
        max_jitter: Duration::from_millis(250),
    };
}

/// The calls that share a budget: one account's calls to one app.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct BudgetLane {
    /// The account whose quota the calls spend.
    pub account: MacroUserIdStr<'static>,
    /// The app they call.
    pub app: ConnectedAppRef,
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

    fn cool_down(&self, until: Instant) {
        let mut schedule = self.schedule();
        schedule.cooldown_until = Some(schedule.cooldown_until.map_or(until, |at| at.max(until)));
    }

    fn cooling(&self, now: Instant) -> bool {
        self.schedule()
            .cooldown_until
            .is_some_and(|until| until > now)
    }
}

impl CallBudget {
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
            "connected_app.budget",
            app_kind = ?lane.app.kind,
            app_key = %lane.app.key,
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
            let mut retry_after = None;
            let result = loop {
                let queued = Instant::now();
                let Ok(Ok(permit)) =
                    tokio::time::timeout_at(deadline, lane.permits.acquire()).await
                else {
                    waited += queued.elapsed();
                    break Err(EgressError::RateLimited { retry_after });
                };
                let Some(start) = lane.reserve(policy.interval, deadline) else {
                    waited += queued.elapsed();
                    break Err(EgressError::RateLimited { retry_after });
                };
                tokio::time::sleep_until(start).await;
                waited += queued.elapsed();
                // A 429 that landed while this call waited for its slot.
                if lane.cooling(Instant::now()) {
                    continue;
                }
                attempts += 1;
                let outcome = call().await;
                drop(permit);
                match outcome {
                    Err(EgressError::RateLimited { retry_after: asked }) => {
                        refusals += 1;
                        retry_after = asked;
                        let jitter = Duration::from_millis(rand::random_range(
                            0..=u64::try_from(policy.max_jitter.as_millis()).unwrap_or(u64::MAX),
                        ));
                        lane.cool_down(
                            Instant::now() + asked.unwrap_or(policy.default_retry_after) + jitter,
                        );
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
                    "connected app still rate limited at the deadline"
                );
            }
            result
        }
        .instrument(span)
        .await
    }
}
