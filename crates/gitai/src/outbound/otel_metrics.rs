use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Meter};

use crate::domain::metrics::Metric;
use crate::domain::ports::IngestMetrics;

/// The METRICS contract's counters on the global meter provider, which
/// `macro_entrypoint` exports over OTLP. Instrument names are fixed by that
/// contract; Prometheus adds `_total`.
pub struct OtelMetrics {
    batches: Counter<u64>,
    events: Counter<u64>,
    redaction_hits: Counter<u64>,
    commits: Counter<u64>,
    lines: Counter<u64>,
    tokens: Counter<u64>,
    cost: Counter<f64>,
    sessions: Counter<u64>,
}

impl OtelMetrics {
    /// Instruments on `opentelemetry::global::meter("gitai")`. Build it after
    /// `MacroEntrypoint::init`, which installs the provider.
    pub fn new() -> Self {
        Self::on(&opentelemetry::global::meter("gitai"))
    }

    fn on(meter: &Meter) -> Self {
        Self {
            batches: meter.u64_counter("gitai.ingest.batches").build(),
            events: meter.u64_counter("gitai.ingest.events").build(),
            redaction_hits: meter.u64_counter("gitai.redaction.hits").build(),
            commits: meter.u64_counter("gitai.commits").build(),
            lines: meter.u64_counter("gitai.lines").build(),
            tokens: meter.u64_counter("gitai.tokens").build(),
            cost: meter.f64_counter("gitai.cost").build(),
            sessions: meter.u64_counter("gitai.sessions").build(),
        }
    }
}

impl Default for OtelMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl IngestMetrics for OtelMetrics {
    fn record(&self, metric: Metric) {
        match metric {
            Metric::Batch {
                endpoint,
                result,
                client_version,
            } => self.batches.add(
                1,
                &[
                    KeyValue::new("endpoint", <&str>::from(endpoint)),
                    KeyValue::new("result", <&str>::from(result)),
                    KeyValue::new("client_version", client_version),
                ],
            ),
            Metric::Events {
                event,
                result,
                count,
            } => self.events.add(
                count,
                &[
                    KeyValue::new("event", event.as_str()),
                    KeyValue::new("result", <&str>::from(result)),
                ],
            ),
            Metric::RedactionHits { rule, count } => self
                .redaction_hits
                .add(count, &[KeyValue::new("rule", rule.as_str())]),
            Metric::Commit { repo, author } => self.commits.add(
                1,
                &[KeyValue::new("repo", repo), KeyValue::new("author", author)],
            ),
            Metric::Lines {
                repo,
                author,
                tool,
                model,
                kind,
                count,
            } => self.lines.add(
                count,
                &[
                    KeyValue::new("repo", repo),
                    KeyValue::new("author", author),
                    KeyValue::new("tool", tool),
                    KeyValue::new("model", model),
                    KeyValue::new("kind", <&str>::from(kind)),
                ],
            ),
            Metric::Tokens {
                author,
                tool,
                model,
                kind,
                count,
            } => self.tokens.add(
                count,
                &[
                    KeyValue::new("author", author),
                    KeyValue::new("tool", tool),
                    KeyValue::new("model", model),
                    KeyValue::new("type", <&str>::from(kind)),
                ],
            ),
            Metric::Cost {
                author,
                tool,
                model,
                usd,
            } => self.cost.add(
                usd,
                &[
                    KeyValue::new("author", author),
                    KeyValue::new("tool", tool),
                    KeyValue::new("model", model),
                ],
            ),
            Metric::SessionStarted { author, tool } => self.sessions.add(
                1,
                &[KeyValue::new("author", author), KeyValue::new("tool", tool)],
            ),
        }
    }
}
