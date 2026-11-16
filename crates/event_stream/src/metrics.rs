//! OpenTelemetry metrics for public event streams (plan 5.5), on the
//! process' global meter (`macro_entrypoint` exports it). One number per
//! process with low-cardinality attributes only; no ids.

use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Histogram, UpDownCounter};
use std::sync::OnceLock;

/// The instruments.
pub struct StreamMetrics {
    /// Open streams in this process.
    pub open_streams: UpDownCounter<i64>,
    /// Streams closed, by reason (`client`, `lagged`, `revoked`, `reset`,
    /// `shutdown`).
    pub closes: Counter<u64>,
    /// Milliseconds from a log append to its fan-out in this process.
    pub fan_out_lag_ms: Histogram<u64>,
    /// Milliseconds from the Kafka record's timestamp to its log append.
    pub append_lag_ms: Histogram<u64>,
    /// Times the tail lost its place and reset every stream.
    pub tail_gaps: Counter<u64>,
}

/// The process' instruments, created on first use.
pub fn metrics() -> &'static StreamMetrics {
    static METRICS: OnceLock<StreamMetrics> = OnceLock::new();
    METRICS.get_or_init(|| {
        let meter = opentelemetry::global::meter("event_stream");
        StreamMetrics {
            open_streams: meter
                .i64_up_down_counter("events.stream.open")
                .with_description("Open public event streams")
                .build(),
            closes: meter
                .u64_counter("events.stream.closes")
                .with_description("Public event streams closed, by reason")
                .build(),
            fan_out_lag_ms: meter
                .u64_histogram("events.stream.fan_out_lag")
                .with_unit("ms")
                .with_description("Time from a public event log append to its fan-out")
                .build(),
            append_lag_ms: meter
                .u64_histogram("events.log.append_lag")
                .with_unit("ms")
                .with_description("Time from the Kafka record to its public event log append")
                .build(),
            tail_gaps: meter
                .u64_counter("events.stream.tail_gaps")
                .with_description("Public event log tail gaps that reset every stream")
                .build(),
        }
    })
}

/// Record one close.
pub fn record_close(reason: &'static str) {
    let metrics = metrics();
    metrics.open_streams.add(-1, &[]);
    metrics.closes.add(1, &[KeyValue::new("reason", reason)]);
}
