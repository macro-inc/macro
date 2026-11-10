//! Context carried by durable computer work, independent of its transport.
use opentelemetry::trace::{Span as _, SpanKind, TraceContextExt, Tracer};
use opentelemetry::{Context, KeyValue, global};
use std::collections::HashMap;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::domain::lifecycle::ComputerState;
use crate::domain::models::HostAllocation;
use crate::domain::setup::{PhaseTiming, SetupTimeline};

/// Current W3C context, absent when no tracing provider is enabled.
pub fn traceparent() -> Option<String> {
    let mut carrier = HashMap::new();
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&tracing::Span::current().context(), &mut carrier)
    });
    carrier.remove("traceparent")
}

/// Attach durable context before entering a new span; already-running callbacks link instead.
pub fn attach(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let Some(parent) = remote_parent(traceparent) else {
        return;
    };
    let origin = parent.span().span_context().clone();
    if span.set_parent(parent).is_err() {
        span.add_link(origin);
    }
}

fn remote_parent(traceparent: &str) -> Option<Context> {
    let carrier = HashMap::from([("traceparent".to_owned(), traceparent.to_owned())]);
    let parent = global::get_text_map_propagator(|propagator| propagator.extract(&carrier));
    parent.span().span_context().is_valid().then_some(parent)
}

/// Whether `traceparent` is a valid, propagatable W3C parent.
/// Checked without the process propagator, so daemons that export nothing can still forward it.
pub fn is_valid_traceparent(traceparent: &str) -> bool {
    use opentelemetry::trace::{SpanId, TraceId};
    let parts: Vec<&str> = traceparent.split('-').collect();
    let hex = |part: &str, len: usize| {
        part.len() == len && part.bytes().all(|byte| byte.is_ascii_hexdigit())
    };
    matches!(parts.as_slice(), [version, trace, span, flags]
        if *version == "00"
            && hex(trace, 32)
            && hex(span, 16)
            && hex(flags, 2)
            && TraceId::from_hex(trace).is_ok_and(|id| id != TraceId::INVALID)
            && SpanId::from_hex(span).is_ok_and(|id| id != SpanId::INVALID))
}

/// Before entering `span`: parent it under the purchase while first setup
/// runs, so the whole setup is one trace; later work only links to it.
pub fn adopt(span: &tracing::Span, state: &ComputerState) {
    match state.setup_traceparent() {
        Some(parent) => attach(span, Some(parent)),
        None => {
            if let Some(origin) = state
                .provision_traceparent
                .as_deref()
                .and_then(remote_parent)
            {
                span.add_link(origin.span().span_context().clone());
            }
        }
    }
}

/// Opaque, low-cardinality-safe identity stamped on setup wait spans.
#[derive(Debug, Clone)]
pub struct SetupAttributes {
    /// Computer UUID.
    pub computer_id: String,
    /// Team UUID.
    pub team_id: String,
    /// Size name.
    pub size: String,
    /// Host UUID, while the computer holds one.
    pub host_id: Option<String>,
    /// Enrollment generation of the guest being set up.
    pub generation: i64,
    /// `stripe` or `comped`.
    pub billing_kind: &'static str,
}

impl SetupAttributes {
    fn key_values(&self, setup: &SetupTimeline) -> Vec<KeyValue> {
        let mut values = vec![
            KeyValue::new("computer_id", self.computer_id.clone()),
            KeyValue::new("team_id", self.team_id.clone()),
            KeyValue::new("size", self.size.clone()),
            KeyValue::new("generation", self.generation),
            KeyValue::new("billing_kind", self.billing_kind),
            KeyValue::new("capacity_waited", setup.waited_for_capacity),
        ];
        if let Some(host) = &self.host_id {
            values.push(KeyValue::new("host_id", host.clone()));
        }
        values
    }
}

/// Export finished setup waits as spans with their recorded start and end,
/// under the purchase trace, plus the total once macrod first connected.
pub fn setup_waits<T: Tracer>(
    tracer: &T,
    traceparent: Option<&str>,
    setup: &SetupTimeline,
    finished: &[PhaseTiming],
    attributes: &SetupAttributes,
) {
    if finished.is_empty() {
        return;
    }
    let parent = traceparent.and_then(remote_parent).unwrap_or_default();
    let values = attributes.key_values(setup);
    let emit = |name: &'static str, phase: &'static str, started, ended| {
        let mut span = tracer
            .span_builder(name)
            .with_kind(SpanKind::Internal)
            .with_start_time(std::time::SystemTime::from(started))
            .with_attributes(
                values
                    .iter()
                    .cloned()
                    .chain([KeyValue::new("setup.phase", phase)]),
            )
            .start_with_context(tracer, &parent);
        span.end_with_timestamp(std::time::SystemTime::from(ended));
    };
    let meter = global::meter("hosted_runtimes");
    let phases = meter
        .f64_histogram("computer.setup.phase.duration")
        .with_unit("s")
        .build();
    for timing in finished {
        emit(
            timing.phase.span_name(),
            timing.phase.into(),
            timing.started_at,
            timing.ended_at,
        );
        phases.record(
            seconds(timing.started_at, timing.ended_at),
            &[KeyValue::new("phase", <&'static str>::from(timing.phase))],
        );
    }
    if let Some((started, ended)) = setup.total()
        && finished
            .iter()
            .any(|timing| timing.phase == crate::domain::setup::SetupPhase::Boot)
    {
        emit("computer.setup", "total", started, ended);
        meter
            .f64_histogram("computer.setup.duration")
            .with_unit("s")
            .build()
            .record(seconds(started, ended), &[]);
    }
}

/// [`setup_waits`] through the process-wide tracer provider.
pub fn record_setup_waits(
    traceparent: Option<&str>,
    setup: &SetupTimeline,
    finished: &[PhaseTiming],
    attributes: &SetupAttributes,
) {
    setup_waits(
        &global::tracer("hosted_runtimes"),
        traceparent,
        setup,
        finished,
        attributes,
    );
}

fn seconds(started: chrono::DateTime<chrono::Utc>, ended: chrono::DateTime<chrono::Utc>) -> f64 {
    (ended - started).num_milliseconds().max(0) as f64 / 1000.0
}

/// A resource counted by `computer.capacity.*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum CapacityResource {
    SoldUnits,
    Vcpus,
    MemoryGib,
    DiskGib,
}

/// What computers hold against capacity, on one host or summed over the fleet.
#[derive(Default)]
struct Held {
    sold_units: u64,
    sold_capacity_units: u64,
    vcpus: u64,
    memory_gib: u64,
    disk_gib: u64,
}

impl Held {
    fn add(&mut self, allocation: &HostAllocation) {
        self.sold_units += u64::from(allocation.sold_units);
        self.sold_capacity_units += u64::from(allocation.host.sold_capacity_units);
        self.vcpus += u64::from(allocation.vcpus);
        self.memory_gib += u64::from(allocation.memory_gib);
        self.disk_gib += u64::from(allocation.disk_gib);
    }

    /// Each resource's allocation, and its capacity where the model bounds it.
    /// Hosts record no separate vCPU, memory or disk capacity: units bound
    /// vCPU and memory together, and disk is not bounded.
    fn readings(&self) -> [(CapacityResource, u64, Option<u64>); 4] {
        [
            (
                CapacityResource::SoldUnits,
                self.sold_units,
                Some(self.sold_capacity_units),
            ),
            (CapacityResource::Vcpus, self.vcpus, None),
            (CapacityResource::MemoryGib, self.memory_gib, None),
            (CapacityResource::DiskGib, self.disk_gib, None),
        ]
    }
}

/// Gauge what computers hold on each host and across the fleet as
/// `computer.capacity.allocated`, with `computer.capacity.total` beside it.
fn capacity(meter: &opentelemetry::metrics::Meter, allocations: &[HostAllocation]) {
    let allocated = meter.u64_gauge("computer.capacity.allocated").build();
    let total = meter.u64_gauge("computer.capacity.total").build();
    let record = |held: &Held, scope: &[KeyValue]| {
        for (resource, value, capacity) in held.readings() {
            let resource: &'static str = resource.into();
            let attributes: Vec<KeyValue> = scope
                .iter()
                .cloned()
                .chain([KeyValue::new("resource", resource)])
                .collect();
            allocated.record(value, &attributes);
            if let Some(capacity) = capacity {
                total.record(capacity, &attributes);
            }
        }
    };

    let mut fleet = Held::default();
    for allocation in allocations {
        let mut host = Held::default();
        host.add(allocation);
        fleet.add(allocation);
        record(
            &host,
            &[
                KeyValue::new("scope", "host"),
                KeyValue::new("host_id", allocation.host.id.to_string()),
                KeyValue::new("host", allocation.host.name.clone()),
            ],
        );
    }
    record(&fleet, &[KeyValue::new("scope", "fleet")]);
}

/// [`capacity`] through the process-wide meter provider.
pub fn record_capacity(allocations: &[HostAllocation]) {
    capacity(&global::meter("hosted_runtimes"), allocations);
}

/// Link an already-running callback to the durable provisioning trace.
pub fn resume(traceparent: Option<&str>) {
    attach(&tracing::Span::current(), traceparent);
}

/// Record a failed attempt even when the worker schedules a retry successfully.
pub fn effect_failed(phase: &str) {
    tracing::Span::current().record("otel.status_code", "ERROR");
    global::meter("hosted_runtimes")
        .u64_counter("computer.effect.failures")
        .build()
        .add(1, &[KeyValue::new("phase", phase.to_owned())]);
}

/// Time from reservation to the first macrod connection, without entity metric labels.
pub fn provisioned(seconds: f64) {
    global::meter("hosted_runtimes")
        .f64_histogram("computer.provisioning.duration")
        .with_unit("s")
        .build()
        .record(seconds, &[]);
}

#[cfg(test)]
mod test;
