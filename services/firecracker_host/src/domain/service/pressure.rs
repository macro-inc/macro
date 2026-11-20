//! CPU and memory pressure relief the agent decides on its own, from what
//! it sees on the host:
//!
//! - every running computer's `cpu.weight` follows its activity
//!   (`domain::activity`), sampled every [`ACTIVITY_INTERVAL`];
//! - the zram squeeze: while the host's memory in use (`MemTotal -
//!   MemAvailable`, as the control plane's watermarks count it) is inside
//!   the squeeze window of the host limits (between the low and high
//!   watermark), the
//!   computer quiet the longest (at least [`SQUEEZE_AFTER`]) has its memory
//!   pushed to zstd zram with `memory.reclaim`, one computer at a time
//!   (~6 s each). A squeezed idle macro-box drops from ~643 to ~310 MiB and
//!   wakes from zram in ~0.1 s (`density.md`). Above the high watermark the
//!   control plane hibernates the idlest instead.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use firecracker_host_api::{ComputerId, PowerState};
use strum::IntoEnumIterator;

use super::{HostProbe, HostService, SwapPlacement};
use crate::domain::activity::{Activity, ActivitySettings, ActivityTracker};
use crate::domain::ports::{Disks, Goldens, Machines, Store};

#[cfg(test)]
mod test;

/// Between activity samples.
pub const ACTIVITY_INTERVAL: Duration = Duration::from_secs(10);
/// Quiet this long before a computer is squeezed.
pub const SQUEEZE_AFTER: Duration = Duration::from_secs(30 * 60);

/// Host memory in use between which the squeeze runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqueezeWindow {
    /// The low watermark: squeeze only above it.
    pub above_bytes: u64,
    /// The high watermark: above it hibernation is the relief.
    pub below_bytes: u64,
}

/// What the agent tracks per running computer.
#[derive(Debug, Clone)]
pub struct Tracked {
    tracker: ActivityTracker,
    /// The class whose weight the cgroup has; `None` until a write worked.
    applied: Option<Activity>,
    /// Squeezed since it was last busy.
    squeezed: bool,
}

/// One computer as the squeeze sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqueezeView {
    /// Which.
    pub computer_id: ComputerId,
    /// Since its last busy sample.
    pub quiet_for: Duration,
    /// Squeezed since then.
    pub squeezed: bool,
}

/// The computer to squeeze next, if any: only while `used_bytes` is inside
/// `window`, the one quiet the longest among those quiet for
/// [`SQUEEZE_AFTER`] and not squeezed since.
pub fn squeeze_candidate(
    used_bytes: u64,
    window: SqueezeWindow,
    computers: &[SqueezeView],
) -> Option<ComputerId> {
    if used_bytes <= window.above_bytes || used_bytes >= window.below_bytes {
        return None;
    }
    computers
        .iter()
        .filter(|computer| !computer.squeezed && computer.quiet_for >= SQUEEZE_AFTER)
        .max_by_key(|computer| computer.quiet_for)
        .map(|computer| computer.computer_id)
}

/// What one squeeze did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Squeezed {
    /// Which computer.
    pub computer_id: ComputerId,
    /// How much its charge fell.
    pub reclaimed_bytes: u64,
}

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    fn tracked(&self) -> std::sync::MutexGuard<'_, HashMap<ComputerId, Tracked>> {
        self.activity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Sample every running computer's CPU, reclassify it, and write the
    /// `cpu.weight` of each whose class changed (or whose last write
    /// failed). Records the activity gauges.
    pub fn activity_pass(&self, now: Instant, settings: &ActivitySettings) {
        let running: Vec<_> = self
            .running
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .filter(|record| record.state == PowerState::Running)
            .filter_map(|record| record.process.map(|process| (record.clone(), process)))
            .collect();
        let mut counts: HashMap<Activity, u64> = Activity::iter().map(|class| (class, 0)).collect();
        let mut tracked = self.tracked();
        tracked.retain(|computer_id, _| {
            running
                .iter()
                .any(|(record, _)| record.computer_id == *computer_id)
        });
        for (record, process) in &running {
            let Some(usage) = self.machines.usage(record, *process) else {
                continue;
            };
            let entry = tracked
                .entry(record.computer_id)
                .or_insert_with(|| Tracked {
                    tracker: ActivityTracker::new(usage.cpu_usage_microseconds, now),
                    applied: None,
                    squeezed: false,
                });
            entry
                .tracker
                .observe(usage.cpu_usage_microseconds, now, settings);
            if entry.tracker.quiet_for(now).is_zero() {
                // Busy again: its pages are coming back from zram.
                entry.squeezed = false;
            }
            let activity = entry.tracker.activity();
            *counts.entry(activity).or_default() += 1;
            if entry.applied == Some(activity) {
                continue;
            }
            match self
                .machines
                .set_cpu_weight(record, *process, activity.cpu_weight())
            {
                Ok(()) => {
                    tracing::debug!(computer_id = %record.computer_id, activity = %activity, "cpu.weight set");
                    entry.applied = Some(activity);
                    self.metrics.cpu_weight_changed(activity);
                }
                Err(error) => {
                    tracing::warn!(computer_id = %record.computer_id, activity = %activity, error = ?error, "could not set cpu.weight; retrying next sample");
                }
            }
        }
        drop(tracked);
        self.metrics.activity(&counts);
    }

    /// The squeeze window of the host limits; `None` without both ends.
    pub fn squeeze_window(&self) -> Option<SqueezeWindow> {
        let limits = self.host_limits()?;
        Some(SqueezeWindow {
            above_bytes: limits.squeeze_above_bytes?,
            below_bytes: limits.squeeze_below_bytes?,
        })
    }

    /// Squeeze the next candidate inside `window`; `None` when there is
    /// nothing to do now.
    pub async fn squeeze_once(&self, window: SqueezeWindow, now: Instant) -> Option<Squeezed> {
        let measurement = self.probe.measure();
        if measurement.swap_placement != SwapPlacement::RamOnly {
            // Reclaim would push guest pages to the disk; the swap health
            // check says why.
            return None;
        }
        let used_bytes = measurement
            .memory_total_bytes
            .saturating_sub(measurement.memory_available_bytes);
        let views: Vec<SqueezeView> = self
            .tracked()
            .iter()
            .map(|(computer_id, tracked)| SqueezeView {
                computer_id: *computer_id,
                quiet_for: tracked.tracker.quiet_for(now),
                squeezed: tracked.squeezed,
            })
            .collect();
        let computer_id = squeeze_candidate(used_bytes, window, &views)?;
        // Marked first, so a failing computer is not retried in a loop.
        if let Some(tracked) = self.tracked().get_mut(&computer_id) {
            tracked.squeezed = true;
        }
        let record = self.running_copy(computer_id)?;
        let process = record.process?;
        let usage = self.machines.usage(&record, process)?;
        let started = Instant::now();
        let reclaimed = self
            .machines
            .reclaim_memory(&record, process, usage.resident_memory_bytes)
            .await;
        self.metrics
            .squeezed(started.elapsed(), reclaimed.as_ref().ok().copied());
        match reclaimed {
            Ok(reclaimed_bytes) => {
                tracing::info!(
                    computer_id = %computer_id,
                    reclaimed_bytes = i64::try_from(reclaimed_bytes).unwrap_or(i64::MAX),
                    host_used_bytes = i64::try_from(used_bytes).unwrap_or(i64::MAX),
                    "squeezed into zram"
                );
                Some(Squeezed {
                    computer_id,
                    reclaimed_bytes,
                })
            }
            Err(error) => {
                tracing::warn!(computer_id = %computer_id, error = ?error, "squeeze failed");
                Some(Squeezed {
                    computer_id,
                    reclaimed_bytes: 0,
                })
            }
        }
    }
}
