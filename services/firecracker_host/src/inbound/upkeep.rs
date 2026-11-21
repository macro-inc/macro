//! The agent's periodic upkeep: reconcile computers no operation holds,
//! run the health checks, and record the gauges. The gauges double as the
//! heartbeat (`firecracker_host.ready`), so a pass runs at least as often
//! as the meter exports.

use std::sync::Arc;
use std::time::Duration;

use tokio_util::sync::CancellationToken;
use tracing::Instrument;

use crate::domain::activity::ActivitySettings;
use crate::domain::ports::{Disks, Goldens, Machines, Store};
use crate::domain::service::pressure::ACTIVITY_INTERVAL;
use crate::domain::service::{HostProbe, HostService};
use crate::inbound::health::Health;

/// Between passes: the meter's export interval.
pub const INTERVAL: Duration = Duration::from_secs(60);

/// Run passes every [`INTERVAL`], the first at once, until `shutdown`.
pub async fn run<S, D, G, M, P>(health: Arc<Health<S, D, G, M, P>>, shutdown: CancellationToken)
where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    let mut ticks = tokio::time::interval(INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            () = shutdown.cancelled() => return,
            _ = ticks.tick() => {}
        }
        pass(&health)
            .instrument(tracing::info_span!(
                "firecracker_host.upkeep",
                ready = tracing::field::Empty
            ))
            .await;
    }
}

/// Sample every running computer's activity every [`ACTIVITY_INTERVAL`]
/// and keep its `cpu.weight` in step, until `shutdown`.
pub async fn run_activity<S, D, G, M, P>(
    service: Arc<HostService<S, D, G, M, P>>,
    shutdown: CancellationToken,
) where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    let settings = ActivitySettings::default();
    let mut ticks = tokio::time::interval(ACTIVITY_INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            () = shutdown.cancelled() => return,
            _ = ticks.tick() => {}
        }
        tracing::debug_span!("firecracker_host.activity")
            .in_scope(|| service.activity_pass(std::time::Instant::now(), &settings));
    }
}

/// Between squeeze rounds: each round squeezes computers one after
/// another until none is left to squeeze or the host is out of the window.
pub const SQUEEZE_INTERVAL: Duration = Duration::from_secs(60);

/// The zram squeeze in the background, until `shutdown`.
pub async fn run_squeeze<S, D, G, M, P>(
    service: Arc<HostService<S, D, G, M, P>>,
    shutdown: CancellationToken,
) where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    let mut ticks = tokio::time::interval(SQUEEZE_INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            () = shutdown.cancelled() => return,
            _ = ticks.tick() => {}
        }
        while let Some(window) = service.squeeze_window() {
            if shutdown.is_cancelled() {
                return;
            }
            let squeezed = service
                .squeeze_once(window, std::time::Instant::now())
                .instrument(tracing::info_span!("firecracker_host.squeeze"))
                .await;
            if squeezed.is_none() {
                break;
            }
        }
    }
}

/// One pass.
pub async fn pass<S, D, G, M, P>(health: &Health<S, D, G, M, P>)
where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    health.service.guard_guest_swap().await;
    health.service.reconcile_pass().await;
    health.service.collect_garbage().await;
    health.service.prepare_home_templates().await;
    health.service.refill_spares().await;
    let (report, storage) = health.report().await;
    tracing::Span::current().record("ready", report.ready);
    if !report.ready {
        let failed: Vec<_> = report
            .checks
            .iter()
            .filter(|check| !check.healthy)
            .map(|check| check.check.as_str())
            .collect();
        tracing::warn!(failed = ?failed, "host not ready");
    }
    health.service.record_sample(storage, &report);
}
