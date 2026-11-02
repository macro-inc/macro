//! Product analytics for routine runs: one `routine_run_finished` event per
//! run that starts, whether a schedule, its owner or an event started it.

#[cfg(test)]
mod test;

use agent_harness_service::product_analytics::ProductAnalytics;
use scheduled_action::domain::ports::{
    FinishedRoutineRun, RoutineRunObserver, RunEnd, RunTarget, RunTrigger,
};
use serde::Serialize;

/// Sends each finished routine run to PostHog as its owner.
pub struct RoutineAnalytics(pub ProductAnalytics);

impl RoutineRunObserver for RoutineAnalytics {
    fn run_finished(&self, run: FinishedRoutineRun) {
        let owner = run.owner.clone();
        self.0
            .track(owner, "routine_run_finished", RunProperties::from(&run));
    }
}

/// Ids, kinds and timings only: never the routine's prompt or output.
#[derive(Debug, PartialEq, Serialize)]
struct RunProperties {
    routine_id: uuid::Uuid,
    /// `scheduled`, `manual` or `event`.
    trigger: &'static str,
    /// The event that fired an event-triggered run, e.g. `email.message_received`.
    #[serde(skip_serializing_if = "Option::is_none")]
    trigger_event: Option<&'static str>,
    /// `model` or `agent`, or `unknown` when the task could not be read.
    target: &'static str,
    /// `succeeded`, `failed`, `interrupted` or `ai_limit_reached`.
    outcome: &'static str,
    duration_ms: i64,
}

impl From<&FinishedRoutineRun> for RunProperties {
    fn from(run: &FinishedRoutineRun) -> Self {
        let (trigger, trigger_event) = match run.trigger {
            RunTrigger::Scheduled => ("scheduled", None),
            RunTrigger::Manual => ("manual", None),
            RunTrigger::Event(name) => ("event", Some(name.as_str())),
        };
        Self {
            routine_id: run.routine_id,
            trigger,
            trigger_event,
            target: match run.target {
                RunTarget::Model => "model",
                RunTarget::Agent => "agent",
                RunTarget::Unknown => "unknown",
            },
            outcome: match run.end {
                RunEnd::Succeeded => "succeeded",
                RunEnd::Failed => "failed",
                RunEnd::Interrupted => "interrupted",
                RunEnd::AiLimitReached => "ai_limit_reached",
            },
            duration_ms: run.duration.num_milliseconds(),
        }
    }
}
