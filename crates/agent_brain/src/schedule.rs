//! Heartbeats and cron jobs: run a closure on a schedule until cancelled.
//!
//! ```no_run
//! use std::time::Duration;
//! use agent_brain::schedule::{Job, Trigger};
//! use agent_brain::CancellationToken;
//!
//! # async fn demo() -> agent_brain::Result<()> {
//! let cancel = CancellationToken::new();
//! Job::new("heartbeat", Trigger::every(Duration::from_secs(30 * 60)))
//!     .spawn(cancel.clone(), || async { /* wake the agent */ });
//! Job::new("morning", Trigger::cron("0 9 * * 1-5")?)
//!     .spawn(cancel.clone(), || async { /* weekday 09:00 UTC */ });
//! # Ok(()) }
//! ```

use std::future::Future;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

use crate::error::{Error, Result};

#[cfg(test)]
mod test;

/// When a job fires.
#[derive(Debug, Clone)]
pub enum Trigger {
    /// Every fixed period, measured on the tokio clock.
    Every(Duration),
    /// On a cron schedule, evaluated in UTC on the wall clock.
    Cron(Box<cron::Schedule>),
}

impl Trigger {
    /// Every `period` (at least one millisecond).
    pub fn every(period: Duration) -> Self {
        Self::Every(period.max(Duration::from_millis(1)))
    }

    /// A cron expression in UTC. Accepts standard five-field cron
    /// (`min hour day month weekday`) or the six/seven-field form with
    /// seconds (and year) first.
    pub fn cron(expression: &str) -> Result<Self> {
        let fields = expression.split_whitespace().count();
        let full = if fields == 5 {
            format!("0 {expression}")
        } else {
            expression.to_owned()
        };
        cron::Schedule::from_str(&full)
            .map(|schedule| Self::Cron(Box::new(schedule)))
            .map_err(|e| Error::Schedule(format!("{expression:?}: {e}")))
    }

    /// How long after `now` a cron trigger fires next; `None` for a cron
    /// schedule with no future time, and for `Every` (which uses the tokio
    /// clock instead).
    pub fn next_cron_delay(&self, now: DateTime<Utc>) -> Option<Duration> {
        match self {
            Self::Every(_) => None,
            Self::Cron(schedule) => schedule
                .after(&now)
                .next()
                .map(|next| (next - now).to_std().unwrap_or_default()),
        }
    }
}

/// A named job on a trigger.
#[derive(Debug, Clone)]
pub struct Job {
    name: String,
    trigger: Trigger,
    run_at_start: bool,
}

impl Job {
    /// A job called `name` (used in traces) that fires on `trigger`.
    pub fn new(name: impl Into<String>, trigger: Trigger) -> Self {
        Self {
            name: name.into(),
            trigger,
            run_at_start: false,
        }
    }

    /// Also run once as soon as the job starts.
    pub fn run_at_start(mut self, yes: bool) -> Self {
        self.run_at_start = yes;
        self
    }

    /// Run `job` on every firing until `cancel` fires. A firing that comes
    /// while the previous run is still going is skipped, never stacked.
    pub fn spawn<F, Fut>(self, cancel: CancellationToken, job: F) -> JoinHandle<()>
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        tokio::spawn(self.run(cancel, job))
    }

    async fn run<F, Fut>(self, cancel: CancellationToken, job: F)
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let running = Arc::new(AtomicBool::new(false));
        let fire = |name: &str| {
            if running.swap(true, Ordering::AcqRel) {
                tracing::info!(job = name, "previous run still going; skipping this one");
                return;
            }
            let running = Arc::clone(&running);
            let span = tracing::info_span!("agent_brain.schedule.run", job = name);
            let run = job();
            tokio::spawn(
                async move {
                    run.await;
                    running.store(false, Ordering::Release);
                }
                .instrument(span),
            );
        };
        if self.run_at_start {
            fire(&self.name);
        }
        let mut interval = match &self.trigger {
            Trigger::Every(period) => {
                let mut interval =
                    tokio::time::interval_at(tokio::time::Instant::now() + *period, *period);
                interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
                Some(interval)
            }
            Trigger::Cron(_) => None,
        };
        loop {
            let wait = async {
                match interval.as_mut() {
                    Some(interval) => {
                        interval.tick().await;
                        true
                    }
                    None => match self.trigger.next_cron_delay(Utc::now()) {
                        Some(delay) => {
                            tokio::time::sleep(delay).await;
                            true
                        }
                        None => false,
                    },
                }
            };
            tokio::select! {
                () = cancel.cancelled() => return,
                more = wait => {
                    if !more {
                        tracing::info!(job = %self.name, "schedule has no future runs; stopping");
                        return;
                    }
                    fire(&self.name);
                }
            }
        }
    }
}
