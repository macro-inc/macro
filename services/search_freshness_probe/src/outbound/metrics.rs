//! Rounds as OpenTelemetry metrics. Their names and tags are the contract of
//! infra/stacks/monitoring/monitors/search-freshness.ts.

use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Histogram, Meter};

use crate::domain::model::{Outcome, Round};
use crate::domain::ports::RoundSink;

#[cfg(test)]
mod test;

const METER_NAME: &str = "search_freshness_probe";
/// Seconds from an acknowledged write to the first search that showed it.
pub const PROBE_SECONDS: &str = "search.freshness.probe_seconds";
/// Finished rounds.
pub const PROBE_ROUNDS: &str = "search.freshness.probe_rounds";
const ENTITY_TYPE: &str = "entity_type";
const OPERATION: &str = "operation";
const OUTCOME: &str = "outcome";

/// Bucket bounds, in seconds, around the 60 s target; a round gives up at 300.
const BOUNDARIES_S: [f64; 13] = [
    1.0, 2.0, 3.0, 5.0, 10.0, 15.0, 20.0, 30.0, 45.0, 60.0, 120.0, 180.0, 300.0,
];

/// The probe's instruments.
#[derive(Clone)]
pub struct ProbeMetrics {
    seconds: Histogram<f64>,
    rounds: Counter<u64>,
}

impl ProbeMetrics {
    /// Instruments on the global meter provider `macro_entrypoint` installs.
    pub fn global() -> Self {
        Self::new(&opentelemetry::global::meter(METER_NAME))
    }

    fn new(meter: &Meter) -> Self {
        Self {
            seconds: meter
                .f64_histogram(PROBE_SECONDS)
                .with_unit("s")
                .with_description(
                    "Time from an acknowledged write to the first search that showed it",
                )
                .with_boundaries(BOUNDARIES_S.to_vec())
                .build(),
            rounds: meter
                .u64_counter(PROBE_ROUNDS)
                .with_description("Probe rounds, by how they ended")
                .build(),
        }
    }
}

impl RoundSink for ProbeMetrics {
    fn record(&self, round: Round) {
        let mut tags = vec![
            KeyValue::new(ENTITY_TYPE, round.entity_type.as_str()),
            KeyValue::new(OPERATION, round.operation.as_str()),
        ];
        if let Outcome::Seen(after) | Outcome::Late(after) = round.outcome {
            self.seconds.record(after.as_secs_f64(), &tags);
        }
        tags.push(KeyValue::new(OUTCOME, round.outcome.as_str()));
        self.rounds.add(1, &tags);
    }
}
