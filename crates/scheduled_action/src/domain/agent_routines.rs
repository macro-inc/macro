//! The routines an agent account owns, summarized for the people who oversee
//! that agent (its dashboard's routines pane).
//!
//! Routine reads are otherwise strictly owner-scoped. This read widens who
//! can see that a routine exists, never what it does: a summary carries the
//! name, schedule state and last outcome, and leaves out the task, steps,
//! description, event filters and run results.

use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::Serialize;
use utoipa::ToSchema;

use super::models::{ActionExecutionRecord, ActionPolicyError};
use super::ports::{AgentRoutineService, AgentRoutineStore, ScheduledActionRepo};

#[cfg(test)]
mod test;

/// PostHog rollout of agent dashboards, evaluated for the caller; missing
/// configuration and failed evaluations stay off.
pub const AGENT_DASHBOARDS_FLAG: &str = "enable-agent-dashboards";
/// Most routines one summary lists.
pub const MAX_AGENT_ROUTINES: u8 = 50;

/// An agent's top-level routines, oldest first.
#[derive(Serialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoutines {
    pub routines: Vec<AgentRoutine>,
    /// True when the agent owns more than 50 top-level routines and the
    /// newest were left out.
    pub truncated: bool,
}

/// One routine, without its content.
#[derive(Serialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoutine {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub name: String,
    pub enabled: bool,
    /// A run is in progress: the routine is claimed and its claim has not
    /// expired.
    pub running: bool,
    pub trigger_kind: TriggerKind,
    /// The next scheduled firing; absent for event routines and finished
    /// one-time ones.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<DateTime<Utc>>,
    /// The latest finished run, absent when it never ran.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<LastRun>,
}

/// What kind of trigger starts a routine, as `ActionTrigger` names it.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema, strum::EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TriggerKind {
    Cron,
    Events,
    Once,
    Multiple,
}

/// When a routine's latest finished run ran and whether it succeeded.
#[derive(Serialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub succeeded: bool,
}

impl From<&ActionExecutionRecord> for LastRun {
    fn from(record: &ActionExecutionRecord) -> Self {
        Self {
            started_at: record.start_time,
            ended_at: record.end_time,
            succeeded: record.is_success,
        }
    }
}

/// Who is asking, relative to the agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Viewer {
    /// The agent reading its own routines.
    Agent,
    /// An owner or admin of a team the agent belongs to.
    Overseer,
}

pub struct AgentRoutineServiceImpl<Store, Runs, Flags> {
    store: Arc<Store>,
    runs: Arc<Runs>,
    flags: Option<Flags>,
}

impl<Store, Runs, Flags> AgentRoutineServiceImpl<Store, Runs, Flags> {
    pub fn new(store: Arc<Store>, runs: Arc<Runs>, flags: Option<Flags>) -> Self {
        Self { store, runs, flags }
    }
}

impl<Store: AgentRoutineStore, Runs, Flags: FeatureFlags>
    AgentRoutineServiceImpl<Store, Runs, Flags>
{
    async fn dashboards_enabled(&self, viewer: &MacroUserIdStr<'_>) -> bool {
        let Some(flags) = &self.flags else {
            return false;
        };
        flags
            .load(viewer)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    ?error,
                    "feature flags unavailable; agent dashboards stay off"
                );
            })
            .is_ok_and(|snapshot| snapshot.is_enabled(AGENT_DASHBOARDS_FLAG))
    }

    /// Whether `viewer` may read `agent`'s routines, and as whom. Anyone
    /// else gets the same answer as for an agent that doesn't exist.
    async fn viewer(
        &self,
        viewer: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<Viewer>> {
        if viewer == agent {
            return Ok(Some(Viewer::Agent));
        }
        if self.store.oversees(viewer, agent).await? {
            return Ok(Some(Viewer::Overseer));
        }
        Ok(None)
    }
}

impl<Store, Runs, Flags> AgentRoutineService for AgentRoutineServiceImpl<Store, Runs, Flags>
where
    Store: AgentRoutineStore,
    Runs: ScheduledActionRepo,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(
        name = "routine.agent_list",
        err,
        skip_all,
        fields(
            routine.viewer = tracing::field::Empty,
            routine.count = tracing::field::Empty,
            routine.truncated = tracing::field::Empty,
        )
    )]
    async fn agent_routines(
        &self,
        viewer: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentRoutines> {
        if !self.dashboards_enabled(viewer).await {
            anyhow::bail!(ActionPolicyError::NotFound);
        }
        let Some(role) = self.viewer(viewer, agent).await? else {
            anyhow::bail!(ActionPolicyError::NotFound);
        };
        let span = tracing::Span::current();
        span.record("routine.viewer", <&str>::from(role));

        // One more than the cap says whether any were left out.
        let mut routines = self
            .store
            .top_level_routines(agent, MAX_AGENT_ROUTINES + 1)
            .await?;
        let truncated = routines.len() > usize::from(MAX_AGENT_ROUTINES);
        routines.truncate(usize::from(MAX_AGENT_ROUTINES));

        let ids: Vec<Uuid> = routines.iter().map(|routine| routine.id).collect();
        let last_runs = self.runs.last_runs(&ids).await?;
        for routine in &mut routines {
            routine.last_run = last_runs.get(&routine.id).map(LastRun::from);
        }

        span.record("routine.count", routines.len());
        span.record("routine.truncated", truncated);
        Ok(AgentRoutines {
            routines,
            truncated,
        })
    }
}
