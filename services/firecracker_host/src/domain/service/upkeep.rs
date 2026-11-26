//! What the agent's periodic upkeep reads from the service: a sample for
//! the gauges and the service's own readiness checks.

use std::sync::PoisonError;
use std::sync::atomic::Ordering;

use firecracker_host_api::{GoldenKey, GoldenState, PowerState};

use super::{HostProbe, HostService, SwapPlacement};
use crate::domain::health::{CheckOutcome, HealthCheck, HealthReport};
use crate::domain::metrics::{HostSample, StorageUsage};
use crate::domain::ports::{Disks, GoldenAvailability, Goldens, GuestSwap, Machines, Store};

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    /// Finish deferred disk deletes; failures are logged, the next pass
    /// tries again.
    pub async fn collect_garbage(&self) {
        if let Err(error) = self.disks.collect_garbage().await {
            tracing::warn!(error = %error, "deferred disk deletes failed; retrying next pass");
        }
    }

    /// Make every sold size's empty `/home`; failures are logged and the
    /// readiness check stays failed.
    pub async fn prepare_home_templates(&self) {
        if let Err(error) = self
            .disks
            .prepare_home_templates(&self.restorable_goldens(), &self.home_sizes_gib())
            .await
        {
            tracing::error!(error = ?error, "making the /home templates failed");
        }
    }

    /// Top up the ready disk sets of every restorable golden; failures are
    /// logged, creates clone instead.
    pub async fn refill_spares(&self) {
        if let Err(error) = self
            .disks
            .refill_spares(&self.restorable_goldens(), &self.home_sizes_gib())
            .await
        {
            tracing::warn!(error = ?error, "refilling spare disk sets failed; creates clone meanwhile");
        }
    }

    /// Let VMs swap only while all swap stays in RAM: a swap device on
    /// disk (say, one added by hand) gets none of their memory, whether the
    /// squeeze or the kernel's own reclaim would push it. Applied on change.
    pub async fn guard_guest_swap(&self) {
        let placement = self.probe.measure().swap_placement;
        let swap = match placement {
            SwapPlacement::RamOnly => GuestSwap::Allowed,
            SwapPlacement::Disk { .. } | SwapPlacement::Unknown => GuestSwap::Off,
        };
        if *self
            .guest_swap
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            == Some(swap)
        {
            return;
        }
        match self.machines.set_guest_swap(swap).await {
            Ok(()) => {
                *self
                    .guest_swap
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner) = Some(swap);
                match swap {
                    GuestSwap::Allowed => tracing::info!("all swap is in RAM: VMs may swap"),
                    GuestSwap::Off => {
                        tracing::warn!(placement = ?placement, "swap may reach a disk: VMs may not swap");
                    }
                }
            }
            Err(error) => {
                tracing::error!(error = ?error, swap = ?swap, "setting the VMs' swap limit failed; retrying next pass");
            }
        }
    }

    /// Goldens a create can use: ready and their image still installed.
    fn restorable_goldens(&self) -> Vec<GoldenKey> {
        self.goldens
            .list()
            .into_iter()
            .map(|golden| golden.key)
            .filter(|key| self.goldens.availability(key) == GoldenAvailability::Ready)
            .collect()
    }

    /// The host now.
    pub fn sample(&self) -> HostSample {
        let mut computers: Vec<(PowerState, u64)> = [
            PowerState::Running,
            PowerState::Paused,
            PowerState::Hibernated,
            PowerState::Stopped,
        ]
        .into_iter()
        .map(|state| (state, 0))
        .collect();
        for state in self
            .states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
        {
            if let Some((_, count)) = computers.iter_mut().find(|(each, _)| each == state) {
                *count += 1;
            }
        }
        let measurement = self.probe.measure();
        let (slots_total, slots_free) = {
            let slots = self.slot_pool();
            (u64::from(slots.total()), slots.free() as u64)
        };
        let concurrent = u64::from(self.settings.concurrent_launches);
        let available = self.launches.available_permits() as u64;
        HostSample {
            computers,
            launch_queue_depth: self.launches_waiting.load(Ordering::Relaxed),
            launches_in_flight: concurrent.saturating_sub(available),
            slots_total,
            slots_free,
            guest_resident_memory_bytes: measurement.guest_resident_memory_bytes,
            memory_available_bytes: measurement.memory_available_bytes,
            memory_total_bytes: measurement.memory_total_bytes,
            ksm_shared_bytes: measurement.ksm_shared_bytes,
            swap_used_bytes: measurement.swap_used_bytes,
            zram_used_bytes: measurement.zram_used_bytes,
        }
    }

    /// The checks only the service can answer: a restorable golden, and a
    /// reconcile that left nothing unresolved.
    pub fn service_checks(&self) -> Vec<CheckOutcome> {
        let golden = if self
            .goldens
            .list()
            .iter()
            .any(|golden| matches!(golden.state, GoldenState::Ready { .. }))
        {
            CheckOutcome::passed(HealthCheck::Golden)
        } else {
            CheckOutcome::failed(HealthCheck::Golden, "no golden is restorable")
        };
        let reconcile = if self.reconcile_clean.load(Ordering::Relaxed) {
            CheckOutcome::passed(HealthCheck::Reconcile)
        } else {
            CheckOutcome::failed(
                HealthCheck::Reconcile,
                "the last reconcile left problems; its log has them",
            )
        };
        let measurement = self.probe.measure();
        let swap = match measurement.swap_placement {
            SwapPlacement::Unknown => CheckOutcome::failed(
                HealthCheck::Swap,
                "/proc/swaps is unreadable: swap may be on disk, so VMs may not swap",
            ),
            SwapPlacement::Disk { .. } => CheckOutcome::failed(
                HealthCheck::Swap,
                "a swap device that writes to disk is active (not zram, or zram with writeback): VMs may not swap",
            ),
            SwapPlacement::RamOnly
                if self.squeeze_window().is_some() && measurement.swap_total_bytes == 0 =>
            {
                CheckOutcome::failed(
                    HealthCheck::Swap,
                    "the host limits ask for the zram squeeze, but the host has no swap",
                )
            }
            SwapPlacement::RamOnly => CheckOutcome::passed(HealthCheck::Swap),
        };
        let home_templates = if self
            .disks
            .home_templates_ready(&self.restorable_goldens(), &self.home_sizes_gib())
        {
            CheckOutcome::passed(HealthCheck::HomeTemplates)
        } else {
            CheckOutcome::failed(
                HealthCheck::HomeTemplates,
                "the /home templates of the sizes in the host limits are not made yet",
            )
        };
        vec![golden, reconcile, swap, home_templates]
    }

    /// Record the upkeep's gauges.
    pub fn record_sample(&self, storage: Option<StorageUsage>, health: &HealthReport) {
        self.metrics.sample(&self.sample(), storage, health);
    }
}
