//! The overcommit pass, every few seconds per driven host: store the host's
//! memory report (admission refuses on a stale one), hand the host agent its
//! limits (the hard ceiling and the squeeze window), wake hibernated
//! computers whose wake was asked for as the host has room, and above the
//! high watermark hibernate the idlest guests ([`overcommit::relieve`]).
//!
//! Wakes run through a per-host queue `max_concurrent_starts` wide: a bounded
//! queue restores a burst of wakes faster than letting them all run at once.

use std::collections::HashMap;
use std::sync::Arc;

use futures::StreamExt;
use tracing::Instrument;

use super::*;
use crate::domain::overcommit::telemetry::{
    self as overcommit_telemetry, HibernationOutcome, WakeOutcome, WakeReason,
};
use crate::domain::overcommit::{self, ActivitySample, ActivityTracker, WakeAdmission};
use crate::domain::ports::{
    ComputersInUse, EveryComputerInUse, GuestUsage, HostLimitsState, OvercommitRepo, UsageHistory,
};
use crate::domain::usage::{self, UsageSample};

/// Hibernations relief runs at once on one host; each takes ~3 s.
const HIBERNATIONS_AT_ONCE: usize = 4;
const MIB: u64 = 1024 * 1024;
/// Between deletions of usage readings past their retention. Pruning rides
/// on the overcommit pass, the only writer of readings: while it does not
/// run, nothing is written and nothing is pruned.
const USAGE_PRUNE_EVERY: chrono::Duration = chrono::Duration::minutes(10);

/// What the overcommit pass keeps between passes.
pub(super) struct Relief {
    activity: std::sync::Mutex<HashMap<HostId, ActivityTracker>>,
    wake_queues: std::sync::Mutex<HashMap<HostId, (u32, Arc<tokio::sync::Semaphore>)>>,
    /// Signalled when a harness's macrod connects, for dispatches waiting on a wake.
    connections: std::sync::Mutex<HashMap<HarnessId, Arc<tokio::sync::Notify>>>,
    in_use: Arc<dyn ComputersInUse>,
    /// The minute of each host's last kept usage reading.
    usage_minutes: std::sync::Mutex<HashMap<HostId, DateTime<Utc>>>,
    /// When usage readings were last pruned.
    usage_pruned_at: std::sync::Mutex<Option<DateTime<Utc>>>,
}

impl Default for Relief {
    fn default() -> Self {
        Self {
            activity: std::sync::Mutex::default(),
            wake_queues: std::sync::Mutex::default(),
            connections: std::sync::Mutex::default(),
            in_use: Arc::new(EveryComputerInUse),
            usage_minutes: std::sync::Mutex::default(),
            usage_pruned_at: std::sync::Mutex::default(),
        }
    }
}

impl Relief {
    /// The host's wake queue, rebuilt when its width changes.
    fn wake_queue(&self, host: HostId, width: u32) -> Arc<tokio::sync::Semaphore> {
        let mut queues = self
            .wake_queues
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = queues
            .entry(host)
            .or_insert_with(|| (width, Arc::new(tokio::sync::Semaphore::new(width as usize))));
        if entry.0 != width {
            *entry = (width, Arc::new(tokio::sync::Semaphore::new(width as usize)));
        }
        Arc::clone(&entry.1)
    }

    /// Wake whoever waits for `harness`'s macrod.
    pub(super) fn macrod_connected(&self, harness: HarnessId) {
        if let Some(signal) = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&harness)
        {
            signal.notify_waiters();
        }
    }

    fn connection_signal(&self, harness: HarnessId) -> Arc<tokio::sync::Notify> {
        Arc::clone(
            self.connections
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .entry(harness)
                .or_default(),
        )
    }

    /// Drop `harness`'s signal once nobody else waits on it.
    fn release_connection_signal(&self, harness: HarnessId, signal: Arc<tokio::sync::Notify>) {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        drop(signal);
        if connections
            .get(&harness)
            .is_some_and(|signal| Arc::strong_count(signal) == 1)
        {
            connections.remove(&harness);
        }
    }

    fn observe(
        &self,
        host: HostId,
        samples: &[ActivitySample],
        now: DateTime<Utc>,
    ) -> Vec<overcommit::GuestMemory> {
        self.activity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(host)
            .or_default()
            .observe(samples, now)
    }

    fn forget(&self, host: HostId, computer_id: ComputerId) {
        if let Some(tracker) = self
            .activity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get_mut(&host)
        {
            tracker.forget(computer_id);
        }
    }
}

/// Where a computer's wake stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wake {
    /// It is not hibernated; nothing to wake.
    Awake,
    /// It was restored now.
    Woken,
    /// Its host has no room yet; the overcommit pass wakes it once it has.
    Waiting,
}

/// What a dispatch to a computer's macrod found after asking for a wake.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DispatchWake {
    /// The harness runs on no computer.
    NotAComputer,
    /// The computer was not hibernated; its macrod is away for another reason.
    Awake,
    /// The computer woke and its macrod connected.
    Connected,
    /// The host has no room yet, or macrod did not connect in time; the
    /// overcommit pass keeps waking it and the prompt waits for macrod's dial.
    Waiting,
}

impl<Repo, Machines, Registry, Time, SetupNotifier>
    ComputerOperator<Repo, Machines, Registry, Time, SetupNotifier>
where
    Repo: ComputerRepo
        + crate::domain::agent::ComputerAgents
        + OvercommitRepo
        + UsageHistory
        + crate::domain::moves::ComputerMoves,
    Machines: Fleets,
    Registry: Harnesses,
    Time: Clock,
    SetupNotifier: SetupNotices,
{
    /// Tell relief which computers are in use (live agent sessions, open
    /// shells). Without it every computer counts as in use and relief
    /// hibernates nothing.
    pub fn with_computers_in_use(mut self, in_use: Arc<dyn ComputersInUse>) -> Self {
        self.relief.in_use = in_use;
        self
    }

    /// One overcommit pass over every host this control plane drives; one
    /// failing host skips only itself.
    #[tracing::instrument(name = "computer.overcommit.pass", skip_all, err)]
    pub async fn overcommit(&self) -> Result<(), ComputerError> {
        let home = self.home_host().await?;
        let hosts = self.repo.hosts().await.map_err(internal)?;
        for record in hosts
            .iter()
            .filter(|record| Some(record.id) == home || self.fleet.drives(record))
        {
            let span = tracing::info_span!("computer.overcommit.host", host_id = %record.id, host = %record.name, resident_memory_mib = tracing::field::Empty);
            async {
                let fleet = self.fleet_for(record.id).await?;
                self.overcommit_host(record, &fleet).await
            }
            .instrument(span)
            .await
            .inspect_err(|error| {
                tracing::warn!(host_id = %record.id, host = %record.name, error = ?error, "overcommit pass failed for a host");
            })
            .ok();
        }
        self.prune_usage().await;
        Ok(())
    }

    /// Keep this minute's usage reading of each of the host's running
    /// guests, for the graphs in Settings: the first pass of each minute
    /// writes, the rest do nothing. Never fails the pass; a reading that
    /// could not be kept is tried again on the next pass.
    async fn record_usage(&self, host: HostId, guests: &[GuestUsage], sampled_at: DateTime<Utc>) {
        let minute = usage::minute_of(sampled_at);
        let recorded = self
            .relief
            .usage_minutes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&host)
            .copied();
        if recorded == Some(minute) {
            return;
        }

        let samples: Vec<UsageSample> = guests
            .iter()
            .filter(|guest| !guest.hibernated)
            .filter_map(|guest| {
                Some(UsageSample {
                    computer_id: guest.computer_id,
                    cpu_usage_microseconds: guest.cpu_usage_microseconds?,
                    memory_bytes: guest
                        .private_memory_bytes?
                        .saturating_add(guest.swap_bytes?),
                })
            })
            .collect();
        if !samples.is_empty()
            && let Err(error) = UsageHistory::record_usage(&self.repo, sampled_at, &samples).await
        {
            tracing::warn!(host_id = %host, error = ?error, "could not keep usage readings; the next pass retries");
            return;
        }
        self.relief
            .usage_minutes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(host, minute);
    }

    /// Delete usage readings past their retention, every
    /// [`USAGE_PRUNE_EVERY`]. Never fails the pass.
    async fn prune_usage(&self) {
        let now = self.clock.now();
        let pruned_at = *self
            .relief
            .usage_pruned_at
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if pruned_at.is_some_and(|at| now - at < USAGE_PRUNE_EVERY) {
            return;
        }
        match UsageHistory::prune_usage(&self.repo, now - usage::RETENTION).await {
            Ok(_) => {
                *self
                    .relief
                    .usage_pruned_at
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(now);
            }
            Err(error) => {
                tracing::warn!(error = ?error, "could not prune usage readings; the next pass retries");
            }
        }
    }

    async fn overcommit_host(
        &self,
        record: &HostRecord,
        fleet: &Machines::Fleet,
    ) -> Result<(), ComputerError> {
        let host = record.id;
        let memory = fleet.memory().await.map_err(internal)?;
        self.repo
            .record_memory_report(host, memory.report)
            .await
            .map_err(internal)?;
        let now = self.clock.now();
        let hibernated: Vec<ComputerId> = memory
            .guests
            .iter()
            .filter(|guest| guest.hibernated)
            .map(|guest| guest.computer_id)
            .collect();
        self.repo
            .sync_hibernated(host, &hibernated, now)
            .await
            .map_err(internal)?;
        let Some(capacity) = self
            .repo
            .host_overcommit(host)
            .await
            .map_err(internal)?
            .and_then(|state| state.capacity)
        else {
            return Ok(());
        };
        tracing::Span::current().record("resident_memory_mib", memory.report.resident_memory_mib);
        self.record_usage(host, &memory.guests, memory.report.reported_at)
            .await;

        let limits = capacity.agent_limits(crate::domain::image::sold_home_disk_gib());
        if let HostLimitsState::Enforced(current) = &memory.limits
            && current.as_ref() != Some(&limits)
        {
            let summary = (
                limits.guest_memory_max_mib,
                limits.squeeze_above_mib,
                limits.squeeze_below_mib,
            );
            fleet.set_host_limits(limits).await.map_err(internal)?;
            tracing::info!(host_id = %host, guest_memory_max_mib = summary.0, squeeze_above_mib = summary.1, squeeze_below_mib = summary.2, "set the host's limits");
        }
        if let Some(ratios) = capacity.memory_ratios(memory.report) {
            let age = (now - memory.report.reported_at).num_milliseconds() as f64 / 1000.0;
            overcommit_telemetry::record_memory(host, &record.name, ratios, age);
        }

        self.relieve_host(record, fleet, &capacity, memory.report, &memory.guests, now)
            .await?;
        self.wake_requested(record, fleet).await
    }

    /// Hibernate the idlest guests while the host is over its high watermark.
    async fn relieve_host(
        &self,
        record: &HostRecord,
        fleet: &Machines::Fleet,
        capacity: &overcommit::HostCapacity,
        report: overcommit::MemoryReport,
        guests: &[GuestUsage],
        now: DateTime<Utc>,
    ) -> Result<(), ComputerError> {
        let host = record.id;
        let samples: Vec<ActivitySample> = guests
            .iter()
            .filter(|guest| !guest.hibernated)
            .filter_map(|guest| {
                Some(ActivitySample {
                    computer_id: guest.computer_id,
                    cpu_usage_microseconds: guest.cpu_usage_microseconds?,
                    private_memory_mib: guest.private_memory_bytes? / MIB,
                })
            })
            .collect();
        let mut guests = self.relief.observe(host, &samples, now);
        if !capacity.under_pressure(report) {
            return Ok(());
        }
        // Asked only under pressure, and only about the quiet guests.
        let quiet: Vec<ComputerId> = guests
            .iter()
            .filter(|guest| guest.idle_since.is_some())
            .map(|guest| guest.computer_id)
            .collect();
        let in_use = self
            .relief
            .in_use
            .in_use(&quiet)
            .await
            .map_err(|report| ComputerError::Internal(report.into_dynamic()))?;
        overcommit::mark_in_use(&mut guests, &in_use);
        let picked = overcommit::relieve(capacity, report, &guests, now);
        if picked.is_empty() {
            return Ok(());
        }
        tracing::warn!(host_id = %host, resident_memory_mib = report.resident_memory_mib, picked = picked.len(), "host over its high watermark; hibernating idle computers");
        futures::stream::iter(picked)
            .map(|computer_id| self.hibernate(record, fleet, computer_id))
            .buffer_unordered(HIBERNATIONS_AT_ONCE)
            .collect::<Vec<()>>()
            .await;
        Ok(())
    }

    async fn hibernate(
        &self,
        record: &HostRecord,
        fleet: &Machines::Fleet,
        computer_id: ComputerId,
    ) {
        let span = tracing::info_span!("computer.overcommit.hibernate", computer_id = %computer_id, host_id = %record.id, otel.status_code = tracing::field::Empty);
        async {
            let outcome = match fleet.hibernate(computer_id).await {
                Ok(()) => {
                    self.relief.forget(record.id, computer_id);
                    self.repo
                        .mark_hibernated(computer_id, self.clock.now())
                        .await
                        .inspect_err(|error| tracing::warn!(computer_id = %computer_id, error = ?error, "could not record a hibernation; the next pass will"))
                        .ok();
                    HibernationOutcome::Hibernated
                }
                Err(error) => {
                    tracing::Span::current().record("otel.status_code", "ERROR");
                    tracing::warn!(computer_id = %computer_id, error = ?error, "could not hibernate a computer");
                    HibernationOutcome::Failed
                }
            };
            overcommit_telemetry::hibernation(record.id, &record.name, outcome);
        }
        .instrument(span)
        .await;
    }

    /// Try every wake the host's computers asked for, longest waiting first,
    /// until the host refuses one.
    async fn wake_requested(
        &self,
        record: &HostRecord,
        fleet: &Machines::Fleet,
    ) -> Result<(), ComputerError> {
        for computer_id in self
            .repo
            .wakes_requested(record.id)
            .await
            .map_err(internal)?
        {
            if self
                .try_wake(record, fleet, computer_id, WakeReason::Retry)
                .await?
                == Wake::Waiting
            {
                break;
            }
        }
        Ok(())
    }

    /// Wake the computer behind `harness` if relief hibernated it, and wait
    /// up to `timeout` for its macrod to connect, for a dispatch that found
    /// no live runtime.
    #[tracing::instrument(name = "computer.overcommit.dispatch_wake", skip_all, fields(harness = %harness, computer_id = tracing::field::Empty, outcome = tracing::field::Empty), err)]
    pub async fn wake_for_dispatch(
        &self,
        harness: HarnessId,
        timeout: std::time::Duration,
    ) -> Result<DispatchWake, ComputerError> {
        let Some(computer_id) = self.computer_of(harness).await? else {
            return Ok(DispatchWake::NotAComputer);
        };
        tracing::Span::current().record("computer_id", tracing::field::display(computer_id));
        let signal = self.relief.connection_signal(harness);
        let outcome = {
            let connected = signal.notified();
            tokio::pin!(connected);
            // Registered before the wake, so a connection right after it counts.
            connected.as_mut().enable();
            match self.wake(computer_id, WakeReason::Dispatch).await {
                Ok(Wake::Awake) => Ok(DispatchWake::Awake),
                Ok(Wake::Waiting) => Ok(DispatchWake::Waiting),
                Ok(Wake::Woken) => Ok(match tokio::time::timeout(timeout, connected).await {
                    Ok(()) => DispatchWake::Connected,
                    Err(_) => DispatchWake::Waiting,
                }),
                Err(error) => Err(error),
            }
        };
        self.relief.release_connection_signal(harness, signal);
        if let Ok(outcome) = &outcome {
            tracing::Span::current().record("outcome", tracing::field::debug(outcome));
        }
        outcome
    }

    /// Wake a hibernated computer now if its host has room; otherwise its
    /// wake stays asked for and the overcommit pass retries it. Callers
    /// waiting for macrod wait for its connection afterwards.
    #[tracing::instrument(name = "computer.overcommit.wake_request", skip_all, fields(computer_id = %computer_id, reason = <&'static str>::from(reason), host_id = tracing::field::Empty), err)]
    pub async fn wake(
        &self,
        computer_id: ComputerId,
        reason: WakeReason,
    ) -> Result<Wake, ComputerError> {
        if !self
            .repo
            .request_wake(computer_id, self.clock.now())
            .await
            .map_err(internal)?
        {
            return Ok(Wake::Awake);
        }
        let computer = self
            .repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .and_then(|record| record.into_healthy().ok())
            .ok_or(ComputerError::NotFound)?;
        tracing::Span::current().record("host_id", tracing::field::display(computer.host));
        let record = self
            .repo
            .hosts()
            .await
            .map_err(internal)?
            .into_iter()
            .find(|record| record.id == computer.host)
            .ok_or_else(|| {
                ComputerError::Internal(rootcause::report!("host {} has no row", computer.host))
            })?;
        let fleet = self.fleet_for(computer.host).await?;
        self.try_wake(&record, &fleet, computer_id, reason).await
    }

    async fn try_wake(
        &self,
        record: &HostRecord,
        fleet: &Machines::Fleet,
        computer_id: ComputerId,
        reason: WakeReason,
    ) -> Result<Wake, ComputerError> {
        let span = tracing::info_span!("computer.overcommit.wake", computer_id = %computer_id, host_id = %record.id, reason = <&'static str>::from(reason), outcome = tracing::field::Empty, otel.status_code = tracing::field::Empty);
        async {
            let admission = self
                .repo
                .admit_wake(computer_id, self.clock.now())
                .await
                .map_err(internal)?;
            let (wake, outcome) = match admission {
                WakeAdmission::NotHibernated => return Ok(Wake::Awake),
                WakeAdmission::Refused(_) => (Wake::Waiting, WakeOutcome::Refused),
                WakeAdmission::Admitted => {
                    let width = record.max_concurrent_starts.max(1);
                    let queue = self.relief.wake_queue(record.id, width);
                    let _permit = queue
                        .acquire()
                        .instrument(tracing::info_span!("computer.overcommit.wake_queue"))
                        .await
                        .map_err(internal)?;
                    match fleet.start(computer_id).await {
                        Ok(()) => (Wake::Woken, WakeOutcome::Woken),
                        Err(error) => {
                            tracing::Span::current().record("otel.status_code", "ERROR");
                            tracing::warn!(computer_id = %computer_id, error = ?error, "could not wake a computer");
                            // Hibernated again, and still asked for.
                            let now = self.clock.now();
                            self.repo.mark_hibernated(computer_id, now).await.map_err(internal)?;
                            self.repo.request_wake(computer_id, now).await.map_err(internal)?;
                            (Wake::Waiting, WakeOutcome::Failed)
                        }
                    }
                }
            };
            let label: &'static str = outcome.into();
            tracing::Span::current().record("outcome", label);
            overcommit_telemetry::wake(record.id, reason, outcome);
            Ok(wake)
        }
        .instrument(span)
        .await
    }
}
