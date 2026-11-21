//! The agent's OTel metrics, exported with the spans through
//! `macro_entrypoint`'s meter provider (OTLP to the host's Datadog agent,
//! which tags them with its host). Every attribute is a closed set: no
//! computer ids. Names are a contract with the monitors in
//! `infra/stacks/monitoring`; rename only together with them.

use crate::domain::activity::Activity;
use std::time::Duration;

use firecracker_host_api::{Action, LaunchSource, PowerState};
use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Gauge, Histogram};

use crate::domain::health::{HealthCheck, HealthReport};
use crate::domain::service::HostError;
use crate::domain::service::reconcile::ReconcileReport;

/// Bucket bounds for durations in seconds: restores take ~0.1-2 s,
/// hibernations and cold boots up to a minute, golden builds minutes.
const SECONDS_BOUNDARIES: [f64; 16] = [
    0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0, 1200.0,
];

/// An API operation, for `operation` attributes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Operation {
    /// `PUT` a computer.
    Create,
    /// Start a stopped computer (cold boot or first golden restore).
    Start,
    /// Start a hibernated computer.
    Wake,
    /// Stop.
    Stop,
    /// Restart.
    Restart,
    /// Pause the vCPUs.
    Freeze,
    /// Resume the vCPUs.
    Unfreeze,
    /// Hibernate.
    Hibernate,
    /// Delete a computer.
    Destroy,
    /// Replace the enrollment.
    SetEnrollment,
    /// Remove the enrollment.
    ClearEnrollment,
}

impl Operation {
    /// The power operation `action` is from `state`.
    pub fn power(action: Action, state: PowerState) -> Self {
        match (action, state) {
            (Action::Start, PowerState::Hibernated) => Self::Wake,
            (Action::Start, _) => Self::Start,
            (Action::Stop, _) => Self::Stop,
            (Action::Restart, _) => Self::Restart,
            (Action::Freeze, _) => Self::Freeze,
            (Action::Unfreeze, _) => Self::Unfreeze,
            (Action::Hibernate, _) => Self::Hibernate,
        }
    }
}

/// Something a reconcile put right.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Repair {
    /// A live process kept across an agent restart.
    Adopted,
    /// A computer whose process did not survive (host stop, crash) is
    /// stopped.
    SettledStopped,
    /// A process ended on its own while the agent served.
    ProcessEnded,
    /// A jail no record held (a launch or golden build cut short) removed.
    OrphanJailRemoved,
    /// A hibernation published before the agent died recorded.
    HibernationFinished,
    /// A hibernation the guest ran past deleted.
    StaleHibernationDiscarded,
    /// `macro-restore` run in a guest restored before the agent died.
    RestoreResumed,
}

/// How a golden build ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum GoldenOutcome {
    /// Restorable.
    Published,
    /// Refused: the secret scan found a secret.
    SecretRefused,
    /// Any other failure.
    Failed,
}

/// One sample of the host, for the gauges.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostSample {
    /// Computers in each state.
    pub computers: Vec<(PowerState, u64)>,
    /// Launches waiting for a turn.
    pub launch_queue_depth: u64,
    /// Launches running.
    pub launches_in_flight: u64,
    /// Network slots.
    pub slots_total: u64,
    /// Network slots no process holds.
    pub slots_free: u64,
    /// The VMs' cgroup `memory.current`.
    pub guest_resident_memory_bytes: u64,
    /// `MemAvailable`.
    pub memory_available_bytes: u64,
    /// `MemTotal`.
    pub memory_total_bytes: u64,
    /// KSM-shared memory.
    pub ksm_shared_bytes: u64,
    /// Logical bytes in swap.
    pub swap_used_bytes: u64,
    /// RAM zram holds, compressed.
    pub zram_used_bytes: u64,
}

/// Bytes on the storage computers live on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StorageUsage {
    /// Used.
    pub used_bytes: u64,
    /// Free for the agent.
    pub available_bytes: u64,
}

/// The instruments.
#[derive(Debug, Clone)]
pub struct HostMetrics {
    launch_duration: Histogram<f64>,
    guest_restore_duration: Histogram<f64>,
    hibernate_duration: Histogram<f64>,
    operation_duration: Histogram<f64>,
    operation_failures: Counter<u64>,
    golden_builds: Counter<u64>,
    golden_build_duration: Histogram<f64>,
    computers: Gauge<u64>,
    launch_queue_depth: Gauge<u64>,
    launches_in_flight: Gauge<u64>,
    slots_free: Gauge<u64>,
    slots_total: Gauge<u64>,
    guest_resident_memory: Gauge<u64>,
    memory_available: Gauge<u64>,
    memory_total: Gauge<u64>,
    ksm_shared: Gauge<u64>,
    storage_used: Gauge<u64>,
    storage_available: Gauge<u64>,
    ready: Gauge<u64>,
    health_check: Gauge<u64>,
    reconcile_actions: Counter<u64>,
    reconcile_drift: Gauge<u64>,
    activity: Gauge<u64>,
    cpu_weight_changes: Counter<u64>,
    squeeze_runs: Counter<u64>,
    squeeze_reclaimed: Counter<u64>,
    squeeze_duration: Histogram<f64>,
    swap_used: Gauge<u64>,
    zram_used: Gauge<u64>,
}

impl Default for HostMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl HostMetrics {
    /// Instruments on the global meter provider (a no-op one when nothing
    /// exports).
    pub fn new() -> Self {
        let meter = opentelemetry::global::meter("firecracker_host");
        let seconds = |name: &'static str, description: &'static str| {
            meter
                .f64_histogram(name)
                .with_unit("s")
                .with_description(description)
                .with_boundaries(SECONDS_BOUNDARIES.to_vec())
                .build()
        };
        let gauge = |name: &'static str, unit: &'static str, description: &'static str| {
            meter
                .u64_gauge(name)
                .with_unit(unit)
                .with_description(description)
                .build()
        };
        let counter = |name: &'static str, description: &'static str| {
            meter
                .u64_counter(name)
                .with_description(description)
                .build()
        };
        Self {
            activity: gauge(
                "firecracker_host.computers.activity",
                "{computer}",
                "Running computers by activity class (cpu.weight follows it), every class each sample",
            ),
            cpu_weight_changes: counter(
                "firecracker_host.cpu_weight.changes",
                "cpu.weight writes to a VM cgroup, by the class written",
            ),
            squeeze_runs: counter(
                "firecracker_host.squeeze.runs",
                "memory.reclaim of an idle computer into zram, by outcome",
            ),
            squeeze_reclaimed: counter(
                "firecracker_host.squeeze.reclaimed",
                "Bytes a squeeze took off VM cgroups' memory.current (falls only; never negative)",
            ),
            squeeze_duration: seconds(
                "firecracker_host.squeeze.duration",
                "One computer's memory.reclaim",
            ),
            swap_used: gauge(
                "firecracker_host.memory.swap_used",
                "By",
                "Logical bytes in swap: /proc/meminfo SwapTotal - SwapFree, host-wide",
            ),
            zram_used: gauge(
                "firecracker_host.memory.zram_used",
                "By",
                "RAM the zram devices hold, compressed: mm_stat mem_used_total summed",
            ),
            launch_duration: seconds(
                "firecracker_host.launch.duration",
                "Start of a Firecracker process until it runs: restore, wake or cold boot",
            ),
            guest_restore_duration: seconds(
                "firecracker_host.guest_restore.duration",
                "macro-restore in a restored guest, including reaching its agent",
            ),
            hibernate_duration: seconds(
                "firecracker_host.hibernate.duration",
                "Snapshotting a paused VM and ending it",
            ),
            operation_duration: seconds(
                "firecracker_host.operation.duration",
                "API operations on computers",
            ),
            operation_failures: counter(
                "firecracker_host.operation.failures",
                "API operations on computers that failed",
            ),
            golden_builds: counter("firecracker_host.golden.builds", "Golden builds by outcome"),
            golden_build_duration: seconds(
                "firecracker_host.golden.build.duration",
                "Golden builds, boot to publish",
            ),
            computers: gauge(
                "firecracker_host.computers",
                "{computer}",
                "Computers by state",
            ),
            launch_queue_depth: gauge(
                "firecracker_host.launch.queue_depth",
                "{launch}",
                "Launches waiting for a turn",
            ),
            launches_in_flight: gauge(
                "firecracker_host.launch.in_flight",
                "{launch}",
                "Launches running",
            ),
            slots_free: gauge(
                "firecracker_host.network_slots.free",
                "{slot}",
                "Network slots no process holds",
            ),
            slots_total: gauge(
                "firecracker_host.network_slots.total",
                "{slot}",
                "Network slots",
            ),
            guest_resident_memory: gauge(
                "firecracker_host.memory.guest_resident",
                "By",
                "Memory charged to every VM's cgroup",
            ),
            memory_available: gauge("firecracker_host.memory.available", "By", "MemAvailable"),
            memory_total: gauge("firecracker_host.memory.total", "By", "MemTotal"),
            ksm_shared: gauge(
                "firecracker_host.memory.ksm_shared",
                "By",
                "Memory KSM deduplicates",
            ),
            storage_used: gauge(
                "firecracker_host.storage.used",
                "By",
                "Used on the storage computers live on",
            ),
            storage_available: gauge(
                "firecracker_host.storage.available",
                "By",
                "Free on the storage computers live on",
            ),
            ready: gauge(
                "firecracker_host.ready",
                "1",
                "1 when every health check passes; sent every upkeep, so its absence means the agent is down",
            ),
            health_check: gauge(
                "firecracker_host.health.check",
                "1",
                "1 when the check passes",
            ),
            reconcile_actions: counter(
                "firecracker_host.reconcile.actions",
                "Drift a reconcile repaired",
            ),
            reconcile_drift: gauge(
                "firecracker_host.reconcile.drift",
                "{problem}",
                "Problems the last reconcile could not repair",
            ),
        }
    }

    /// One API operation ended.
    pub fn operation(&self, operation: Operation, took: Duration, result: Result<(), &HostError>) {
        let operation = KeyValue::new("operation", <&'static str>::from(operation));
        let outcome = KeyValue::new("outcome", if result.is_ok() { "ok" } else { "error" });
        self.operation_duration
            .record(took.as_secs_f64(), &[operation.clone(), outcome]);
        if let Err(error) = result {
            self.operation_failures.add(
                1,
                &[operation, KeyValue::new("error_code", error_code(error))],
            );
        }
    }

    /// A launch ended.
    pub fn launch(&self, source: LaunchSource, took: Duration, succeeded: bool) {
        self.launch_duration.record(
            took.as_secs_f64(),
            &[
                KeyValue::new("source", launch_source(source)),
                outcome(succeeded),
            ],
        );
    }

    /// `macro-restore` in a restored guest ended.
    pub fn guest_restore(&self, took: Duration, succeeded: bool) {
        self.guest_restore_duration
            .record(took.as_secs_f64(), &[outcome(succeeded)]);
    }

    /// A hibernation ended.
    pub fn hibernate(&self, took: Duration, succeeded: bool) {
        self.hibernate_duration
            .record(took.as_secs_f64(), &[outcome(succeeded)]);
    }

    /// A golden build ended.
    pub fn golden_build(&self, golden: GoldenOutcome, took: Duration) {
        let golden = KeyValue::new("outcome", <&'static str>::from(golden));
        self.golden_builds.add(1, std::slice::from_ref(&golden));
        self.golden_build_duration
            .record(took.as_secs_f64(), &[golden]);
    }

    /// Drift repaired outside a full pass (an operation found its
    /// process gone); the drift gauge stays the last pass's.
    pub fn repaired(&self, repairs: &[Repair]) {
        for repair in repairs {
            self.reconcile_actions
                .add(1, &[KeyValue::new("action", <&'static str>::from(repair))]);
        }
    }

    /// A full reconcile pass ended: its repairs, and what it left
    /// unresolved (zero once repaired).
    pub fn reconciled(&self, report: &ReconcileReport) {
        self.repaired(&report.repairs);
        self.reconcile_drift.record(
            u64::try_from(report.unresolved.len()).unwrap_or(u64::MAX),
            &[],
        );
    }

    /// Running computers by activity class; every class, zero included.
    pub fn activity(&self, counts: &std::collections::HashMap<Activity, u64>) {
        for class in <Activity as strum::IntoEnumIterator>::iter() {
            self.activity.record(
                counts.get(&class).copied().unwrap_or(0),
                &[KeyValue::new("activity", <&'static str>::from(class))],
            );
        }
    }

    /// A VM cgroup's `cpu.weight` was written for `class`.
    pub fn cpu_weight_changed(&self, class: Activity) {
        self.cpu_weight_changes
            .add(1, &[KeyValue::new("activity", <&'static str>::from(class))]);
    }

    /// A squeeze ended; `reclaimed` is `None` when it failed.
    pub fn squeezed(&self, took: Duration, reclaimed: Option<u64>) {
        let outcome = outcome(reclaimed.is_some());
        self.squeeze_runs.add(1, std::slice::from_ref(&outcome));
        self.squeeze_duration.record(took.as_secs_f64(), &[outcome]);
        if let Some(bytes) = reclaimed {
            self.squeeze_reclaimed.add(bytes, &[]);
        }
    }

    /// The upkeep's sample of the host.
    pub fn sample(
        &self,
        sample: &HostSample,
        storage: Option<StorageUsage>,
        health: &HealthReport,
    ) {
        for (state, count) in &sample.computers {
            self.computers
                .record(*count, &[KeyValue::new("state", state.as_ref().to_owned())]);
        }
        self.launch_queue_depth
            .record(sample.launch_queue_depth, &[]);
        self.launches_in_flight
            .record(sample.launches_in_flight, &[]);
        self.slots_free.record(sample.slots_free, &[]);
        self.slots_total.record(sample.slots_total, &[]);
        self.guest_resident_memory
            .record(sample.guest_resident_memory_bytes, &[]);
        self.memory_available
            .record(sample.memory_available_bytes, &[]);
        self.memory_total.record(sample.memory_total_bytes, &[]);
        self.ksm_shared.record(sample.ksm_shared_bytes, &[]);
        self.swap_used.record(sample.swap_used_bytes, &[]);
        self.zram_used.record(sample.zram_used_bytes, &[]);
        if let Some(storage) = storage {
            self.storage_used.record(storage.used_bytes, &[]);
            self.storage_available.record(storage.available_bytes, &[]);
        }
        for check in &health.checks {
            self.health_check.record(
                u64::from(check.healthy),
                &[KeyValue::new("check", health_check(check.check))],
            );
        }
        self.ready.record(u64::from(health.ready), &[]);
    }
}

fn outcome(succeeded: bool) -> KeyValue {
    KeyValue::new("outcome", if succeeded { "ok" } else { "error" })
}

fn launch_source(source: LaunchSource) -> &'static str {
    match source {
        LaunchSource::Golden => "golden",
        LaunchSource::Hibernation => "hibernation",
        LaunchSource::ColdBoot => "cold_boot",
    }
}

fn health_check(check: HealthCheck) -> &'static str {
    check.as_str()
}

fn error_code(error: &HostError) -> &'static str {
    match error {
        HostError::NotFound(_) => "not_found",
        HostError::GenerationMismatch(_) => "generation_mismatch",
        HostError::InvalidRequest(_) => "invalid_request",
        HostError::ImageMissing(_) => "image_missing",
        HostError::GoldenNotReady(_) => "golden_not_ready",
        HostError::NoNetworkSlot => "no_network_slot",
        HostError::InvalidState(_) => "invalid_state",
        HostError::GuestUnreachable(_) => "guest_unreachable",
        HostError::Staged(_) => "staged",
        HostError::Busy(_) => "busy",
        HostError::MoveRefused(_) => "move_refused",
        HostError::Internal(_) => "internal",
    }
}
