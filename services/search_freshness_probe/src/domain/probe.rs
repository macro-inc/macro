//! One entity type's probe: a round every period, each round one span.

use std::time::Duration;

use tokio::time::{Instant, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::field::{Empty, display};

use super::model::{Outcome, Round};
use super::ports::{NoChange, Rotation, RoundSink, Search};
use super::watch::{Schedule, watch};

#[cfg(test)]
mod test;

/// How often each type starts a round. A round that runs longer delays only
/// its own type's next one.
pub const PERIOD: Duration = Duration::from_secs(60);

/// Runs `rotation` a round every `period` until `shutdown`, then deletes what
/// it created. A shutdown never interrupts a write, so the probe always knows
/// which entities it made; it may cut a round's searching short, and that
/// round is not recorded.
pub async fn run<R: Rotation, S: Search, K: RoundSink>(
    mut rotation: R,
    search: S,
    sink: K,
    schedule: Schedule,
    period: Duration,
    shutdown: CancellationToken,
) {
    let mut ticks = tokio::time::interval(period);
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            biased;
            () = shutdown.cancelled() => break,
            _ = ticks.tick() => {}
        }
        if let Some(round) = round(&mut rotation, &search, schedule, &shutdown).await {
            sink.record(round);
        }
        if shutdown.is_cancelled() {
            break;
        }
    }

    rotation.clean_up().await;
}

#[tracing::instrument(
    name = "search.freshness_probe",
    skip_all,
    fields(
        entity_type = rotation.entity_type().as_str(),
        operation = Empty,
        entity_id = Empty,
        outcome = Empty,
        write_ms = Empty,
        seen_ms = Empty,
        polls = Empty,
        failed_polls = Empty,
        otel.status_code = Empty,
    )
)]
async fn round<R: Rotation, S: Search>(
    rotation: &mut R,
    search: &S,
    schedule: Schedule,
    shutdown: &CancellationToken,
) -> Option<Round> {
    let span = tracing::Span::current();
    let entity_type = rotation.entity_type();
    rotation.prepare().await;
    let started = Instant::now();
    let written = rotation.change().await;
    let written_at = Instant::now();
    span.record("write_ms", millis(written_at - started));

    let (operation, outcome) = match written {
        Err(NoChange::Failed(failed)) => {
            tracing::warn!(error = ?failed, "the probe's write failed");
            (failed.operation, Outcome::WriteFailed)
        }
        Err(NoChange::FixtureMissing(operation)) => (operation, Outcome::FixtureMissing),
        Ok(change) => {
            span.record("entity_id", display(change.entity_id));
            let watched = tokio::select! {
                biased;
                () = shutdown.cancelled() => return None,
                watched = watch(search, &change.checks, schedule, written_at) => watched,
            };
            span.record("polls", watched.polls);
            span.record("failed_polls", watched.failed_polls);
            (change.operation, watched.outcome)
        }
    };

    span.record("operation", operation.as_str());
    span.record("outcome", outcome.as_str());
    let seen_ms = match outcome {
        Outcome::Seen(after) | Outcome::Late(after) => {
            span.record("seen_ms", millis(after));
            Some(millis(after))
        }
        Outcome::Unseen | Outcome::WriteFailed | Outcome::SearchFailed => {
            span.record("otel.status_code", "ERROR");
            None
        }
        Outcome::FixtureMissing => None,
    };
    tracing::debug!(
        entity_type = entity_type.as_str(),
        operation = operation.as_str(),
        outcome = outcome.as_str(),
        seen_ms,
        "probe round finished"
    );

    Some(Round {
        entity_type,
        operation,
        outcome,
    })
}

fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}
