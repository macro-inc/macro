//! Metrics for overcommit: each host's memory against its limits, refused
//! starts and relief's hibernations. Tagged by host name and id so monitors
//! compare a host's usage with its own configured limits.

use opentelemetry::{KeyValue, global};

use super::{MemoryRatios, Refusal};
use crate::domain::ids::HostId;
use crate::domain::models::HostName;

fn host_attributes(host_id: HostId, host: &HostName) -> [KeyValue; 2] {
    [
        KeyValue::new("host_id", host_id.to_string()),
        KeyValue::new("host", host.to_string()),
    ]
}

/// Gauge a host's resident memory and limits as shares of its memory
/// (`computer.host.memory.*_ratio`), and how old its memory report is.
pub fn record_memory(
    host_id: HostId,
    host: &HostName,
    ratios: MemoryRatios,
    report_age_seconds: f64,
) {
    let meter = global::meter("hosted_runtimes");
    let attributes = host_attributes(host_id, host);
    for (name, value) in [
        ("computer.host.memory.used_ratio", ratios.used),
        (
            "computer.host.memory.low_watermark_ratio",
            ratios.low_watermark,
        ),
        (
            "computer.host.memory.high_watermark_ratio",
            ratios.high_watermark,
        ),
        (
            "computer.host.memory.hard_ceiling_ratio",
            ratios.hard_ceiling,
        ),
    ] {
        meter.f64_gauge(name).build().record(value, &attributes);
    }
    meter
        .f64_gauge("computer.host.memory.report_age")
        .with_unit("s")
        .build()
        .record(report_age_seconds, &attributes);
}

/// Count a start or wake the host refused (`computer.overcommit.refusals`).
pub fn refused(host_id: HostId, refusal: Refusal) {
    let reason: &'static str = refusal.into();
    global::meter("hosted_runtimes")
        .u64_counter("computer.overcommit.refusals")
        .build()
        .add(
            1,
            &[
                KeyValue::new("host_id", host_id.to_string()),
                KeyValue::new("reason", reason),
            ],
        );
}

/// How one hibernation by relief ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum HibernationOutcome {
    /// The guest's memory is on disk and its process ended.
    Hibernated,
    /// The host agent refused or failed it; the guest keeps running.
    Failed,
}

/// Count one of relief's hibernations (`computer.overcommit.hibernations`).
pub fn hibernation(host_id: HostId, host: &HostName, outcome: HibernationOutcome) {
    let outcome: &'static str = outcome.into();
    let [id, name] = host_attributes(host_id, host);
    global::meter("hosted_runtimes")
        .u64_counter("computer.overcommit.hibernations")
        .build()
        .add(1, &[id, name, KeyValue::new("outcome", outcome)]);
}

/// What asked a hibernated computer to wake.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum WakeReason {
    /// Its team powered it on or restarted it.
    Power,
    /// The harness has a session or prompt for its macrod.
    Dispatch,
    /// The overcommit pass retried a wake asked for earlier.
    Retry,
}

/// How a wake ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum WakeOutcome {
    /// The guest was restored.
    Woken,
    /// The host had no room; the guest stays hibernated.
    Refused,
    /// The host agent failed the restore; the guest stays hibernated.
    Failed,
}

/// Count a wake of a hibernated computer (`computer.overcommit.wakes`).
pub fn wake(host_id: HostId, reason: WakeReason, outcome: WakeOutcome) {
    let reason: &'static str = reason.into();
    let outcome: &'static str = outcome.into();
    global::meter("hosted_runtimes")
        .u64_counter("computer.overcommit.wakes")
        .build()
        .add(
            1,
            &[
                KeyValue::new("host_id", host_id.to_string()),
                KeyValue::new("reason", reason),
                KeyValue::new("outcome", outcome),
            ],
        );
}
