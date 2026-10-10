//! Usage resets for verified paid-plan changes.

use chrono::{DateTime, Utc};

use super::{BillingPeriod, PlanTier};

#[cfg(test)]
mod test;

/// A plan transition with its original occurrence time and subscription interval.
/// Retaining these facts makes delayed/replayed webhooks use the same baseline.
#[derive(Debug, Clone, Copy)]
pub struct PlanChange {
    /// Plan before the change.
    pub from: PlanTier,
    /// Plan after the change.
    pub to: PlanTier,
    /// When the provider or team service changed the plan.
    pub at: DateTime<Utc>,
    /// Billing interval containing the change; renewal dates remain unchanged.
    pub period: BillingPeriod,
}

impl PlanChange {
    /// Whether the destination gives a higher plan than the source.
    pub fn is_upgrade(from: PlanTier, to: PlanTier) -> bool {
        matches!(
            (from, to),
            (PlanTier::Free, PlanTier::Premium | PlanTier::Max)
                | (PlanTier::Premium, PlanTier::Max)
        )
    }

    /// Only actual transitions within the original interval become history.
    pub fn is_valid(self) -> bool {
        self.from != self.to && self.period.start <= self.at && self.at < self.period.end
    }

    /// Whether this transition can establish a new allowance baseline.
    pub fn resets_usage(self) -> bool {
        Self::is_upgrade(self.from, self.to) && self.is_valid()
    }
}

/// Immutable plan facts and the configured allowances at the time of the change.
#[derive(Debug, Clone, Copy)]
pub struct RecordedPlanChange {
    /// Original transition, including its occurrence time and billing interval.
    pub change: PlanChange,
    /// Previous paid allowance; Free cannot accrue overage.
    pub previous_included_cents: Option<i64>,
    /// Destination paid allowance; Free cannot accrue overage.
    pub new_included_cents: Option<i64>,
}

/// Counted provider costs grouped by a plan boundary, including empty intervals.
#[derive(Debug, Clone, Copy)]
pub struct PlanUsageSegment {
    /// Interval start, either the period start or a recorded transition.
    pub start: DateTime<Utc>,
    /// Provider cost in dollars; rounding applies to cumulative usage.
    pub usd: f64,
}

/// Usage and historical liability after applying a seat's plan history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanUsage {
    /// Current allowance consumption since the most recent eligible upgrade.
    pub used_cents: i64,
    /// Total cost liability across all paid legacy intervals, including old overage.
    pub chargeable_cents: i64,
}

fn rank(tier: PlanTier) -> u8 {
    match tier {
        PlanTier::Free => 0,
        PlanTier::Premium => 1,
        PlanTier::Max => 2,
    }
}

/// Apply immutable history in occurrence order, independent of delivery order.
/// Returning to an already held plan retains consumption. Each paid interval
/// charges only usage newly exceeding its allowance, never reclassifying old use.
pub fn meter_plan_usage(
    changes: &[RecordedPlanChange],
    segments: &[PlanUsageSegment],
    public_funding: bool,
) -> PlanUsage {
    let Some(first) = changes.first() else {
        return PlanUsage {
            used_cents: super::cost_cents(segments.iter().map(|s| s.usd).sum()),
            chargeable_cents: 0,
        };
    };
    let mut highest = if first.change.at == first.change.period.start {
        0
    } else {
        rank(first.change.from)
    };
    let mut allowance = first.previous_included_cents;
    let mut legacy = !public_funding
        || (first.change.from == PlanTier::Max && first.change.at > first.change.period.start);
    let mut usd = 0.0;
    let mut chargeable_cents = 0;
    let mut next = 0;
    for segment in segments {
        while let Some(record) = changes.get(next).filter(|r| r.change.at <= segment.start) {
            if record.change.at > record.change.period.start {
                highest = highest.max(rank(record.change.from));
            }
            if record.change.resets_usage() && rank(record.change.to) > highest {
                usd = 0.0;
            }
            highest = highest.max(rank(record.change.to));
            allowance = record.new_included_cents;
            legacy |= record.change.to == PlanTier::Max;
            next += 1;
        }
        let before = super::cost_cents(usd);
        usd += segment.usd;
        if legacy && let Some(included) = allowance {
            chargeable_cents +=
                (super::cost_cents(usd) - included).max(0) - (before - included).max(0);
        }
    }
    PlanUsage {
        used_cents: super::cost_cents(usd),
        chargeable_cents,
    }
}
