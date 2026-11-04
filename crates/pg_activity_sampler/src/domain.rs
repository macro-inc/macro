//! What a sample is and how often to take one.

use std::time::Duration;

use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// A session whose transaction has been open longer than the threshold.
#[derive(Debug, Clone, PartialEq)]
pub struct LongTransaction {
    /// Server process id, for `pg_cancel_backend` / `pg_terminate_backend`.
    pub pid: i32,
    /// The connecting service's `application_name`; empty when it sets none.
    pub application_name: String,
    /// Database role of the session.
    pub db_user: Option<String>,
    /// `active`, `idle in transaction`, ...
    pub state: Option<String>,
    /// Time since the transaction started.
    pub transaction_age: Duration,
    /// Time since `state` last changed.
    pub state_age: Option<Duration>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    /// The running statement, or the last one when the session is idle.
    pub query: Option<String>,
}

/// The outcome of one sampling attempt.
#[derive(Debug, PartialEq)]
pub enum Sample {
    /// Another replica samples; this one skipped.
    NotLeader,
    /// This replica sampled; every session past the threshold.
    Sessions(Vec<LongTransaction>),
}

/// The sample could not be taken.
#[derive(Debug, thiserror::Error)]
#[error("pg_stat_activity sample failed")]
pub struct SampleError(#[source] pub Box<dyn std::error::Error + Send + Sync>);

/// Reads open transactions from the database.
pub trait ActivitySource: Send {
    /// Sessions whose transaction is older than `older_than`, or
    /// [`Sample::NotLeader`] when another replica is sampling.
    fn long_transactions(
        &mut self,
        older_than: Duration,
    ) -> impl Future<Output = Result<Sample, SampleError>> + Send;
}

/// How often to sample and what counts as long.
#[derive(Debug, Clone, Copy)]
pub struct SamplerConfig {
    pub interval: Duration,
    pub older_than: Duration,
}

/// Samples every `config.interval` until `stop` is cancelled. Failures are
/// logged and retried on the next tick.
pub async fn run(mut source: impl ActivitySource, config: SamplerConfig, stop: CancellationToken) {
    let mut ticks = tokio::time::interval(config.interval);
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            () = stop.cancelled() => return,
            _ = ticks.tick() => {}
        }
        sample_once(&mut source, config.older_than).await;
    }
}

#[tracing::instrument(
    name = "pg_activity.sample",
    skip_all,
    fields(leader = tracing::field::Empty, sessions = tracing::field::Empty)
)]
async fn sample_once(source: &mut impl ActivitySource, older_than: Duration) {
    let span = tracing::Span::current();
    match source.long_transactions(older_than).await {
        Ok(Sample::NotLeader) => {
            span.record("leader", false);
        }
        Ok(Sample::Sessions(sessions)) => {
            span.record("leader", true);
            span.record("sessions", sessions.len());
            for session in &sessions {
                log_long_transaction(session);
            }
        }
        Err(error) => tracing::warn!(error = ?error, "pg activity sample failed"),
    }
}

fn log_long_transaction(session: &LongTransaction) {
    tracing::warn!(
        telemetry_event = "pg_long_transaction",
        pid = session.pid,
        application_name = %session.application_name,
        db_user = session.db_user.as_deref(),
        state = session.state.as_deref(),
        transaction_age_secs = session.transaction_age.as_secs(),
        state_age_secs = session.state_age.map(|age| age.as_secs()),
        wait_event_type = session.wait_event_type.as_deref(),
        wait_event = session.wait_event.as_deref(),
        query = session.query.as_deref(),
        "transaction open past threshold"
    );
}
