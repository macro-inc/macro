//! Setup milestones from purchase to the first macrod connection.
//!
//! The timeline lives in [`crate::domain::lifecycle::ComputerState`] so every
//! process that applies a lifecycle event can close the wait that event ends.
//! Timing is pure; [`crate::domain::telemetry`] turns finished phases into spans.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::lifecycle::Phase;

#[cfg(test)]
mod test;

/// A wait between two setup milestones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum SetupPhase {
    /// Reservation until payment (or comp) confirmation.
    Payment,
    /// Confirmation until the guest boots: outbox wait, fleet create, any capacity wait.
    Create,
    /// Guest boot until macrod enrolls, claims its harness and connects.
    Boot,
}

impl SetupPhase {
    /// Span name for this wait.
    pub fn span_name(self) -> &'static str {
        match self {
            Self::Payment => "computer.setup.payment",
            Self::Create => "computer.setup.create",
            Self::Boot => "computer.setup.boot",
        }
    }
}

/// One finished setup wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhaseTiming {
    /// Which wait finished.
    pub phase: SetupPhase,
    /// When the wait began.
    pub started_at: DateTime<Utc>,
    /// When the next milestone arrived.
    pub ended_at: DateTime<Utc>,
}

/// Milestones of one computer's first setup; latched once macrod connects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetupTimeline {
    /// The purchase reserved capacity (the reservation's creation).
    pub reserved_at: DateTime<Utc>,
    /// Payment or comp confirmed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paid_at: Option<DateTime<Utc>>,
    /// The guest started booting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booting_at: Option<DateTime<Utc>>,
    /// macrod first connected; setup is complete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<DateTime<Utc>>,
    /// The guest waited for host capacity before it could boot.
    #[serde(default)]
    pub waited_for_capacity: bool,
}

impl SetupTimeline {
    /// A setup that began with a reservation at `now`.
    pub fn started(now: DateTime<Utc>) -> Self {
        Self {
            reserved_at: now,
            paid_at: None,
            booting_at: None,
            connected_at: None,
            waited_for_capacity: false,
        }
    }

    /// Whether macrod has connected once.
    pub fn complete(&self) -> bool {
        self.connected_at.is_some()
    }

    /// Reservation until the first macrod connection, once complete.
    pub fn total(&self) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
        self.connected_at.map(|end| (self.reserved_at, end))
    }

    /// Record the milestones the state reached at `now`; returns the waits
    /// that ended, oldest first. Later restarts and reprovisioning add nothing.
    pub fn advance(
        &mut self,
        phase: &Phase,
        macrod_connected: bool,
        waiting_for_capacity: bool,
        now: DateTime<Utc>,
    ) -> Vec<PhaseTiming> {
        let mut finished = Vec::new();
        if self.complete() {
            return finished;
        }
        self.waited_for_capacity |= waiting_for_capacity;
        let booting = matches!(phase, Phase::Booting | Phase::Running);
        // A computer exists only once its purchase is confirmed: the first
        // advance (at conversion) ends the payment wait.
        if self.paid_at.is_none() {
            self.paid_at = Some(now);
            finished.push(PhaseTiming {
                phase: SetupPhase::Payment,
                started_at: self.reserved_at,
                ended_at: now,
            });
        }
        if let Some(paid_at) = self.paid_at
            && self.booting_at.is_none()
            && (booting || macrod_connected)
        {
            self.booting_at = Some(now);
            finished.push(PhaseTiming {
                phase: SetupPhase::Create,
                started_at: paid_at,
                ended_at: now,
            });
        }
        if let Some(booting_at) = self.booting_at
            && macrod_connected
        {
            self.connected_at = Some(now);
            finished.push(PhaseTiming {
                phase: SetupPhase::Boot,
                started_at: booting_at,
                ended_at: now,
            });
        }
        finished
    }
}
