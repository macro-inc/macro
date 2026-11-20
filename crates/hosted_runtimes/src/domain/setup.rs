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
    /// Reservation until payment (or comp) confirmation; a charge runs
    /// beside [`Self::Create`].
    Payment,
    /// Provisioning until the guest boots: outbox wait, fleet create, any capacity wait.
    Create,
    /// Guest boot until macrod enrolls, claims its harness and connects.
    Boot,
    /// An agent teammate's computer: macrod connected until the agent is
    /// handed over, which also waits for the charge to settle.
    AgentHandoff,
    /// The hand-off until the agent reports online.
    AgentStart,
}

impl SetupPhase {
    /// Span name for this wait.
    pub fn span_name(self) -> &'static str {
        match self {
            Self::Payment => "computer.setup.payment",
            Self::Create => "computer.setup.create",
            Self::Boot => "computer.setup.boot",
            Self::AgentHandoff => "computer.setup.agent_handoff",
            Self::AgentStart => "computer.setup.agent_start",
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

/// Where an agent teammate's computer is in handing its agent over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentProgress {
    /// The agent reported online: this event is its report. Giving up on a
    /// start also stops the wait, but is no report.
    pub reported_online: bool,
    /// macrod took the agent: this event says the hand-off finished.
    pub delivered: bool,
}

/// Whether the purchase's payment is confirmed yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentProgress {
    /// Comped, or the charge reached the subscription.
    Settled,
    /// The charge is still running beside provisioning.
    Charging,
}

/// Milestones of one computer's first setup; latched once macrod connects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetupTimeline {
    /// The purchase reserved capacity (the reservation's creation).
    pub reserved_at: DateTime<Utc>,
    /// Payment or comp confirmed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paid_at: Option<DateTime<Utc>>,
    /// The computer was created from its reservation and began
    /// provisioning. Absent in rows written before it existed, which
    /// provisioned only once paid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provisioned_at: Option<DateTime<Utc>>,
    /// The guest started booting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booting_at: Option<DateTime<Utc>>,
    /// macrod first connected; setup is complete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<DateTime<Utc>>,
    /// The guest waited for host capacity before it could boot.
    #[serde(default)]
    pub waited_for_capacity: bool,
    /// The agent teammate was first handed to macrod.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_delivered_at: Option<DateTime<Utc>>,
    /// The agent teammate first reported online.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_online_at: Option<DateTime<Utc>>,
}

impl SetupTimeline {
    /// A setup that began with a reservation at `now`.
    pub fn started(now: DateTime<Utc>) -> Self {
        Self {
            reserved_at: now,
            paid_at: None,
            provisioned_at: None,
            booting_at: None,
            connected_at: None,
            waited_for_capacity: false,
            agent_delivered_at: None,
            agent_online_at: None,
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

    /// When provisioning began: [`Self::provisioned_at`], or for rows
    /// written before it, the payment confirmation that started it.
    pub fn provisioning_started_at(&self) -> Option<DateTime<Utc>> {
        self.provisioned_at.or(self.paid_at)
    }

    /// Record an agent teammate's first hand-off and first online report at
    /// `now`; returns the waits that ended. Only once macrod has connected,
    /// and only the first of each: redeliveries and restarts add nothing.
    pub fn advance_agent(&mut self, agent: AgentProgress, now: DateTime<Utc>) -> Vec<PhaseTiming> {
        let mut finished = Vec::new();
        if let Some(connected_at) = self.connected_at
            && self.agent_delivered_at.is_none()
            && agent.delivered
        {
            self.agent_delivered_at = Some(now);
            finished.push(PhaseTiming {
                phase: SetupPhase::AgentHandoff,
                started_at: connected_at,
                ended_at: now,
            });
        }
        if let Some(delivered_at) = self.agent_delivered_at
            && self.agent_online_at.is_none()
            && agent.reported_online
        {
            self.agent_online_at = Some(now);
            finished.push(PhaseTiming {
                phase: SetupPhase::AgentStart,
                started_at: delivered_at,
                ended_at: now,
            });
        }
        finished
    }

    /// Record the milestones the state reached at `now`; returns the waits
    /// that ended, oldest first. Later restarts and reprovisioning add
    /// nothing, but a charge that settles after setup still ends the
    /// payment wait.
    pub fn advance(
        &mut self,
        phase: &Phase,
        macrod_connected: bool,
        waiting_for_capacity: bool,
        payment: PaymentProgress,
        now: DateTime<Utc>,
    ) -> Vec<PhaseTiming> {
        let mut finished = Vec::new();
        if self.paid_at.is_none() && payment == PaymentProgress::Settled {
            self.paid_at = Some(now);
            finished.push(PhaseTiming {
                phase: SetupPhase::Payment,
                started_at: self.reserved_at,
                ended_at: now,
            });
        }
        if self.complete() {
            return finished;
        }
        self.waited_for_capacity |= waiting_for_capacity;
        let booting = matches!(phase, Phase::Booting | Phase::Running);
        // A computer exists only once its reservation is converted: the
        // first advance is the conversion.
        if self.provisioning_started_at().is_none() {
            self.provisioned_at = Some(now);
        }
        if let Some(provisioned_at) = self.provisioning_started_at()
            && self.booting_at.is_none()
            && (booting || macrod_connected)
        {
            self.booting_at = Some(now);
            finished.push(PhaseTiming {
                phase: SetupPhase::Create,
                started_at: provisioned_at,
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
