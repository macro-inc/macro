//! Learn IDLE restart intervals from independent early disconnects on the same host.
//! Port of EmailEngine's email-client/imap/adaptive-idle.js, with a bounded default watchdog.

use std::collections::BTreeMap;

use chrono::Utc;
use serde::{Deserialize, Serialize};

const LEARN_CEILING: u64 = 25 * 60_000;
const MIN_INTERVAL: u64 = 10_000;
const DEFAULT_SECONDS: u64 = 180;
const MAX_SECONDS: u64 = 240;
const SAME_EVENT_WINDOW: u64 = 10_000;
const PENDING_WINDOW: u64 = 3_600_000;
const STABLE_SESSION: u64 = 30 * 60_000;
const CAP_COOLDOWN: u64 = 24 * PENDING_WINDOW;

/// Observation of a primary connection that closed independently of the caller.
#[derive(Debug, Clone, Copy)]
pub enum Outcome {
    /// An unexpected close during a session. Only a drop while IDLE was active teaches a timeout.
    Drop {
        /// Time since the last client write.
        quiet_ms: u64,
        /// Time since connection establishment.
        age_ms: u64,
        /// Interval this connection used, even if another account has since learned a new one.
        ran_interval_ms: Option<u64>,
        /// Whether the connection was idling at close.
        idling: bool,
    },
    /// A long-lived connection closed.
    Stable {
        /// Time since connection establishment.
        age_ms: u64,
        /// Interval this connection used.
        ran_interval_ms: Option<u64>,
    },
}

/// Serializable per-host learning state. Contains timing data only.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct IdleState {
    interval: Option<u64>,
    pending_quiet: u64,
    pending_at: Option<u64>,
    drops: u8,
    stable: u8,
    age_when_learned: Option<u64>,
    capped_until: u64,
    relaxed_from: Option<u64>,
    relax_limit: Option<u64>,
    evidence_drops: u8,
    evidence_at: Option<u64>,
}

fn similar(a: u64, b: u64, percent: u64) -> bool {
    a != 0 && b != 0 && a.abs_diff(b).saturating_mul(100) <= a.max(b).saturating_mul(percent)
}

fn recent(previous: Option<u64>, now: u64, window: u64) -> bool {
    previous.is_some_and(|at| now.saturating_sub(at) < window)
}

impl IdleState {
    /// Effective restart interval. The watchdog caps the learned value used by the actor.
    pub fn restart_seconds(&self) -> u64 {
        self.interval
            .map(|ms| (ms / 1000).clamp(MIN_INTERVAL / 1000, MAX_SECONDS))
            .unwrap_or(DEFAULT_SECONDS)
    }

    fn clear_pending(&mut self) {
        self.drops = 0;
        self.pending_quiet = 0;
        self.pending_at = None;
    }

    fn clear_evidence(&mut self) {
        self.evidence_drops = 0;
        self.evidence_at = None;
    }

    fn corroborated(&mut self, now: u64) -> bool {
        if recent(self.evidence_at, now, SAME_EVENT_WINDOW) {
            return false;
        }
        self.evidence_at = Some(now);
        self.evidence_drops += 1;
        if self.evidence_drops < 2 {
            return false;
        }
        self.clear_evidence();
        true
    }

    fn stable_session(&mut self, ran_interval_ms: Option<u64>) {
        self.clear_pending();
        self.clear_evidence();
        let Some(interval) = self.interval else {
            return;
        };
        if ran_interval_ms == Some(self.restart_seconds() * 1000) {
            self.relaxed_from = None;
        }
        self.stable += 1;
        if self.stable < 3 {
            return;
        }
        self.stable = 0;
        let relaxed = (interval * 3).div_ceil(2);
        if self.relax_limit.is_some_and(|limit| relaxed >= limit) {
            return;
        }
        self.age_when_learned = None;
        if relaxed >= LEARN_CEILING {
            *self = Self::default();
        } else {
            self.relaxed_from = Some(interval);
            self.interval = Some(relaxed);
        }
    }

    /// Apply an observation at a known wall clock time, in milliseconds since the epoch.
    pub fn observe_at(&mut self, outcome: Outcome, now: u64) {
        if self.capped_until <= now {
            self.capped_until = 0;
        }
        if !recent(self.pending_at, now, PENDING_WINDOW) {
            self.clear_pending();
        }
        if !recent(self.evidence_at, now, PENDING_WINDOW) {
            self.clear_evidence();
        }
        match outcome {
            Outcome::Stable {
                age_ms,
                ran_interval_ms,
            } if age_ms >= STABLE_SESSION => self.stable_session(ran_interval_ms),
            Outcome::Drop {
                quiet_ms,
                age_ms,
                ran_interval_ms,
                idling: true,
            } if (1..LEARN_CEILING).contains(&quiet_ms) && now >= self.capped_until => {
                self.stable = 0;
                let ran = ran_interval_ms.unwrap_or(0);
                let ran_learned = self
                    .interval
                    .is_some_and(|interval| ran > 0 && ran <= interval);
                let restarted = age_ms.saturating_sub(quiet_ms) > ran;
                if let Some(old) = self.relaxed_from
                    && ran_interval_ms == Some(self.restart_seconds() * 1000)
                    && !restarted
                {
                    if self.corroborated(now) {
                        self.relax_limit = self.interval;
                        self.interval = Some(old);
                        self.relaxed_from = None;
                        self.clear_pending();
                    }
                    return;
                }
                if ran_learned
                    && restarted
                    && self
                        .age_when_learned
                        .is_some_and(|age| similar(age_ms, age, 25))
                {
                    if self.corroborated(now) {
                        *self = Self {
                            capped_until: now.saturating_add(CAP_COOLDOWN),
                            ..Self::default()
                        };
                    }
                    return;
                }
                if recent(self.pending_at, now, SAME_EVENT_WINDOW) {
                    return;
                }
                let (tolerance, required) = if self.interval.is_some() {
                    (10, 3)
                } else {
                    (25, 2)
                };
                if similar(quiet_ms, self.pending_quiet, tolerance) {
                    self.drops += 1;
                    self.pending_quiet = quiet_ms.min(self.pending_quiet);
                } else {
                    self.drops = 1;
                    self.pending_quiet = quiet_ms;
                }
                self.pending_at = Some(now);
                if self.drops >= required {
                    let candidate = MIN_INTERVAL.max(self.pending_quiet * 3 / 5);
                    if self.interval.is_none_or(|old| candidate < old) {
                        if self.interval.is_none() {
                            self.age_when_learned = Some(age_ms);
                        }
                        self.interval = Some(candidate);
                        self.relaxed_from = None;
                    }
                    self.clear_pending();
                }
            }
            _ => {}
        }
    }
}

/// Learning shared by primary sessions using the same TLS hostname.
#[derive(Default)]
pub struct IdlePolicy {
    hosts: BTreeMap<String, IdleState>,
}

impl IdlePolicy {
    /// Begin with the default interval for each server.
    pub fn new() -> Self {
        Self::default()
    }

    /// Restore one host's durable timing state before observing its next session.
    pub fn restore(&mut self, host: &str, state: IdleState) {
        let host = host.trim().to_ascii_lowercase();
        if !host.is_empty() {
            self.hosts.insert(host, state);
        }
    }

    /// Snapshot one host for durable storage.
    pub fn state(&self, host: &str) -> Option<&IdleState> {
        self.hosts.get(&host.trim().to_ascii_lowercase())
    }

    /// Read the current watchdog interval, including EmailEngine's known provider limits.
    pub fn restart_seconds(&self, host: &str) -> u64 {
        let host = host.trim().to_ascii_lowercase();
        let maximum = if host.ends_with(".rambler.ru") || host.ends_with(".163.com") {
            55
        } else if host.ends_with(".yahoo.com") {
            180
        } else {
            MAX_SECONDS
        };
        self.hosts
            .get(&host)
            .map_or(DEFAULT_SECONDS, IdleState::restart_seconds)
            .min(maximum)
    }

    /// Coremail ignores NOOP as a keepalive. Use STATUS on a server that lacks IDLE.
    pub fn uses_status_keepalive(host: &str) -> bool {
        host.trim().to_ascii_lowercase().ends_with(".163.com")
    }

    /// Record an independently closed session; the next connection uses the result.
    pub fn observe(&mut self, host: &str, outcome: &Outcome) {
        let key = host.trim().to_ascii_lowercase();
        if key.is_empty() {
            return;
        }
        self.hosts
            .entry(key)
            .or_default()
            .observe_at(*outcome, Utc::now().timestamp_millis().max(0) as u64);
    }
}

#[cfg(test)]
mod test;
