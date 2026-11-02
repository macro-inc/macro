//! How many active routines an owner's plan allows.
//!
//! The limit bounds runaway growth, such as a routine whose runs create more
//! routines, without stopping routines from creating routines.

use ai_billing::PlanTier;

use super::models::ScheduledAction;

#[cfg(test)]
mod test;

const FREE_ACTIVE_ROUTINES: u32 = 10;
const PRO_ACTIVE_ROUTINES: u32 = 100;
const MAX_ACTIVE_ROUTINES: u32 = 10_000;

/// The active routines an owner's plan allows at once. A write that would
/// make one more routine active beyond it is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoutineLimit {
    plan: PlanTier,
    max_active: u32,
}

impl RoutineLimit {
    pub const fn for_plan(plan: PlanTier) -> Self {
        let max_active = match plan {
            PlanTier::Free => FREE_ACTIVE_ROUTINES,
            PlanTier::Premium => PRO_ACTIVE_ROUTINES,
            PlanTier::Max => MAX_ACTIVE_ROUTINES,
        };
        Self { plan, max_active }
    }

    /// The plan the limit comes from.
    pub const fn plan(self) -> PlanTier {
        self.plan
    }

    /// How many routines may be active at once.
    pub const fn max_active(self) -> u32 {
        self.max_active
    }
}

impl ScheduledAction {
    /// Whether the routine can still fire: enabled, and either watching
    /// events or holding a future scheduled firing. Paused routines and
    /// finished one-offs are not active and don't count toward
    /// [`RoutineLimit`]. The repository's active-routine count must match
    /// this definition.
    pub fn is_active(&self) -> bool {
        self.enabled && (self.trigger.event_filters().is_some() || self.next_run_at.is_some())
    }
}
