//! What the wake service needs from the outside.

use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{AgentRelation, StoredWake, ValidWake, WakeCursor, WakeFilter, WakePage};
use super::trace::WakeTrace;

/// What happened to a recorded wake.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    /// It is now the wake's latest record.
    Stored,
    /// A record of a later phase was already stored; this one was dropped.
    Stale,
    /// The wake id is already used by another system.
    OtherSystem,
}

/// The `agent_wakes` table, and the facts about agent accounts it needs.
pub trait WakeRepository: Send + Sync + 'static {
    /// Whether `agent` is an agent account, and whether `caller` owns or
    /// administers a team it is a member of.
    fn relation(
        &self,
        caller: &MacroUserIdStr<'static>,
        agent: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<AgentRelation, rootcause::Report>> + Send;

    /// Store `wake` as the latest record for its id unless a record of a
    /// later phase is already stored.
    fn upsert(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake: &ValidWake,
    ) -> impl Future<Output = Result<UpsertOutcome, rootcause::Report>> + Send;

    /// A page of the agent's wakes matching `filter`, newest first, starting
    /// after `after`.
    fn list(
        &self,
        agent: &MacroUserIdStr<'static>,
        filter: &WakeFilter,
        after: Option<&WakeCursor>,
        limit: u32,
    ) -> impl Future<Output = Result<WakePage, rootcause::Report>> + Send;

    /// One wake.
    fn get(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> impl Future<Output = Result<Option<StoredWake>, rootcause::Report>> + Send;

    /// Note that the wake's trace was replaced at `at`. False when the wake
    /// isn't recorded.
    fn mark_trace(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// One trace blob per wake.
pub trait TraceStore: Send + Sync + 'static {
    /// Replace the wake's trace.
    fn put(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
        trace: &WakeTrace,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// The wake's trace, or `None` when there is none or it has expired.
    fn get(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> impl Future<Output = Result<Option<WakeTrace>, rootcause::Report>> + Send;
}

/// Whether agent dashboards (`enable-agent-dashboards`) are on for a user.
pub trait DashboardsRollout: Send + Sync + 'static {
    /// True when on; a failed lookup counts as off.
    fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> impl Future<Output = bool> + Send;
}

/// The current time.
pub trait Clock: Send + Sync + 'static {
    /// Now.
    fn now(&self) -> DateTime<Utc>;
}
