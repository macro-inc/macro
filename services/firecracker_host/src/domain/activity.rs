//! How busy each running computer is, inferred from its own CPU use, and
//! the `cpu.weight` that follows: at 6:1 vCPU overcommit an active guest
//! runs at 2.8x its idle speed with weight 1000 against neighbours at 100,
//! instead of 9.5x without (`density.md`).
//!
//! A computer is busy when it used more than [`ActivitySettings::busy_cores`]
//! since the last sample. Short bursts are someone working in it: active.
//! Busy without a break for longer than [`ActivitySettings::sustained`] is
//! batch work (a build, an agent grinding): background, so it cannot crowd
//! out the interactive ones. Quiet computers drop to background after
//! [`ActivitySettings::active_linger`] and to idle after
//! [`ActivitySettings::idle_after`]; any busy sample lifts them at once.

use std::time::{Duration, Instant};

#[cfg(test)]
mod test;

/// A computer's activity class.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, strum::Display, strum::IntoStaticStr, strum::EnumIter,
)]
#[strum(serialize_all = "snake_case")]
pub enum Activity {
    /// Used in bursts now or a moment ago.
    Active,
    /// Busy for long without a break, or quiet for a while.
    Background,
    /// Quiet for minutes.
    Idle,
}

impl Activity {
    /// Its cgroup `cpu.weight` (default weight is 100).
    pub fn cpu_weight(self) -> u16 {
        match self {
            Self::Active => 1000,
            Self::Background => 100,
            Self::Idle => 20,
        }
    }
}

/// Thresholds of the classification.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActivitySettings {
    /// CPU over a sample that makes it busy, in cores. An idle macro-box
    /// uses 0.037.
    pub busy_cores: f64,
    /// Busy without a quiet sample this long: background work.
    pub sustained: Duration,
    /// Quiet this long after being active: background.
    pub active_linger: Duration,
    /// Quiet this long: idle.
    pub idle_after: Duration,
}

impl Default for ActivitySettings {
    fn default() -> Self {
        Self {
            busy_cores: 0.2,
            sustained: Duration::from_secs(120),
            active_linger: Duration::from_secs(60),
            idle_after: Duration::from_secs(10 * 60),
        }
    }
}

/// One computer's recent CPU use and class.
#[derive(Debug, Clone)]
pub struct ActivityTracker {
    activity: Activity,
    last_usage_microseconds: u64,
    last_sample: Instant,
    /// When the current run of busy samples began.
    busy_since: Option<Instant>,
    /// The last busy sample, or when tracking began.
    last_busy: Instant,
}

impl ActivityTracker {
    /// A computer just started (or first seen): active, as someone just
    /// asked for it.
    pub fn new(usage_microseconds: u64, now: Instant) -> Self {
        Self {
            activity: Activity::Active,
            last_usage_microseconds: usage_microseconds,
            last_sample: now,
            busy_since: None,
            last_busy: now,
        }
    }

    /// The current class.
    pub fn activity(&self) -> Activity {
        self.activity
    }

    /// How long since the computer was last busy.
    pub fn quiet_for(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.last_busy)
    }

    /// Take a sample of the cgroup's `usage_usec`; returns the new class
    /// when it changed.
    pub fn observe(
        &mut self,
        usage_microseconds: u64,
        now: Instant,
        settings: &ActivitySettings,
    ) -> Option<Activity> {
        let elapsed = now.saturating_duration_since(self.last_sample);
        if elapsed.is_zero() {
            return None;
        }
        // A counter that went back is a new process: no use measured.
        let used = usage_microseconds.saturating_sub(self.last_usage_microseconds);
        self.last_usage_microseconds = usage_microseconds;
        self.last_sample = now;
        let cores = Duration::from_micros(used).as_secs_f64() / elapsed.as_secs_f64();

        let activity = if cores > settings.busy_cores {
            let since = *self.busy_since.get_or_insert(now);
            self.last_busy = now;
            if now.saturating_duration_since(since) >= settings.sustained {
                Activity::Background
            } else {
                Activity::Active
            }
        } else {
            self.busy_since = None;
            let quiet = self.quiet_for(now);
            match self.activity {
                _ if quiet >= settings.idle_after => Activity::Idle,
                Activity::Active if quiet < settings.active_linger => Activity::Active,
                Activity::Active | Activity::Background => Activity::Background,
                // Only a busy sample lifts an idle computer.
                Activity::Idle => Activity::Idle,
            }
        };
        (activity != self.activity).then(|| {
            self.activity = activity;
            activity
        })
    }
}
