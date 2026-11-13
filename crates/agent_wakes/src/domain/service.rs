//! The wake use cases and who may perform them.
//!
//! An agent account records its own wakes and traces. Its wakes are read by
//! the agent itself and by the owners and admins of every team it is a member
//! of. Everything answers "not found" while `enable-agent-dashboards` is off
//! for the caller, and to anyone who may not read the agent, so the routes
//! never reveal which agent accounts exist.

#[cfg(test)]
mod test;

use std::future::Future;

use chrono::DateTime;
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{
    Caller, DEFAULT_PAGE_SIZE, MAX_NAME_LENGTH, MAX_PAGE_SIZE, StoredWake, ValidWake, WakeCursor,
    WakeError, WakeFilter, WakePage, WakeStatus,
};
use super::ports::{Clock, DashboardsRollout, TraceStore, UpsertOutcome, WakeRepository};
use super::record::{WakePhase, WakeRecord};
use super::trace::WakeTrace;

/// The wake use cases, as the inbound adapters call them.
pub trait AgentWakes: Send + Sync + 'static {
    /// Record one of the caller's own wakes. Repeating a record, or sending
    /// one of an earlier phase than the stored one, changes nothing.
    fn record(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        record: WakeRecord,
    ) -> impl Future<Output = Result<(), WakeError>> + Send;

    /// A page of the agent's wakes, newest first.
    fn list(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        filter: WakeFilter,
        after: Option<WakeCursor>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<WakePage, WakeError>> + Send;

    /// One of the agent's wakes.
    fn get(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> impl Future<Output = Result<StoredWake, WakeError>> + Send;

    /// Replace the trace of one of the caller's own recorded wakes.
    fn put_trace(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
        trace: WakeTrace,
    ) -> impl Future<Output = Result<(), WakeError>> + Send;

    /// The trace of one of the agent's wakes.
    fn get_trace(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> impl Future<Output = Result<WakeTrace, WakeError>> + Send;
}

/// [`AgentWakes`] over its ports.
pub struct AgentWakesService<Repo, Traces, Rollout, Time> {
    repository: Repo,
    traces: Traces,
    rollout: Rollout,
    clock: Time,
}

impl<Repo, Traces, Rollout, Time> AgentWakesService<Repo, Traces, Rollout, Time> {
    /// Build the service from its ports.
    pub fn new(repository: Repo, traces: Traces, rollout: Rollout, clock: Time) -> Self {
        Self {
            repository,
            traces,
            rollout,
            clock,
        }
    }
}

/// What the caller may do with an agent's wakes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Access {
    /// Read and write: the agent account itself.
    Agent,
    /// Read only: an owner or admin of one of its teams.
    Reader,
}

impl<Repo, Traces, Rollout, Time> AgentWakesService<Repo, Traces, Rollout, Time>
where
    Repo: WakeRepository,
    Traces: TraceStore,
    Rollout: DashboardsRollout,
    Time: Clock,
{
    /// What the caller may do with the agent's wakes, or not found when
    /// nothing, the agent isn't an agent account, or the feature is off.
    async fn access(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<Access, WakeError> {
        if !self.rollout.enabled_for(&caller.user_id).await {
            return Err(WakeError::NotFound);
        }

        let relation = self
            .repository
            .relation(&caller.user_id, agent)
            .await
            .map_err(WakeError::Storage)?;

        if !relation.is_agent_account {
            return Err(WakeError::NotFound);
        }

        if caller.user_id == *agent {
            return Ok(Access::Agent);
        }

        if relation.caller_administers_agent_team {
            return Ok(Access::Reader);
        }

        Err(WakeError::NotFound)
    }

    async fn require_agent(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<(), WakeError> {
        match self.access(caller, agent).await? {
            Access::Agent => Ok(()),
            Access::Reader => Err(WakeError::Forbidden),
        }
    }
}

impl<Repo, Traces, Rollout, Time> AgentWakes for AgentWakesService<Repo, Traces, Rollout, Time>
where
    Repo: WakeRepository,
    Traces: TraceStore,
    Rollout: DashboardsRollout,
    Time: Clock,
{
    #[tracing::instrument(
        name = "agent_wakes.record",
        skip_all,
        err,
        fields(wake.id = %record.wake, wake.system = %record.system, wake.phase = ?record.phase, stale = tracing::field::Empty)
    )]
    async fn record(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        record: WakeRecord,
    ) -> Result<(), WakeError> {
        self.require_agent(caller, agent).await?;
        let wake = validate(record)?;

        let outcome = self
            .repository
            .upsert(agent, &wake)
            .await
            .map_err(WakeError::Storage)?;

        tracing::Span::current().record("stale", outcome == UpsertOutcome::Stale);
        match outcome {
            UpsertOutcome::Stored | UpsertOutcome::Stale => Ok(()),
            UpsertOutcome::OtherSystem => Err(WakeError::Conflict(wake.record.wake)),
        }
    }

    #[tracing::instrument(
        name = "agent_wakes.list",
        skip_all,
        err,
        fields(count = tracing::field::Empty)
    )]
    async fn list(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        filter: WakeFilter,
        after: Option<WakeCursor>,
        limit: Option<u32>,
    ) -> Result<WakePage, WakeError> {
        self.access(caller, agent).await?;
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);

        let page = self
            .repository
            .list(agent, &filter, after.as_ref(), limit)
            .await
            .map_err(WakeError::Storage)?;

        tracing::Span::current().record("count", page.wakes.len());
        Ok(page)
    }

    #[tracing::instrument(name = "agent_wakes.get", skip_all, err, fields(wake.id = %wake_id))]
    async fn get(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> Result<StoredWake, WakeError> {
        self.access(caller, agent).await?;

        self.repository
            .get(agent, wake_id)
            .await
            .map_err(WakeError::Storage)?
            .ok_or(WakeError::NotFound)
    }

    #[tracing::instrument(
        name = "agent_wakes.put_trace",
        skip_all,
        err,
        fields(wake.id = %wake_id, spans = trace.spans.len(), live = trace.live)
    )]
    async fn put_trace(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
        trace: WakeTrace,
    ) -> Result<(), WakeError> {
        self.require_agent(caller, agent).await?;
        if trace.v != 1 {
            return Err(WakeError::Invalid(format!(
                "trace version {} is not 1",
                trace.v
            )));
        }

        // A trace belongs to a recorded wake: refuse one for a wake that
        // isn't, before storing anything.
        if self
            .repository
            .get(agent, wake_id)
            .await
            .map_err(WakeError::Storage)?
            .is_none()
        {
            return Err(WakeError::NotFound);
        }

        self.traces
            .put(agent, wake_id, &trace)
            .await
            .map_err(WakeError::Storage)?;

        self.repository
            .mark_trace(agent, wake_id, self.clock.now())
            .await
            .map_err(WakeError::Storage)?;
        Ok(())
    }

    #[tracing::instrument(name = "agent_wakes.get_trace", skip_all, err, fields(wake.id = %wake_id))]
    async fn get_trace(
        &self,
        caller: &Caller,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> Result<WakeTrace, WakeError> {
        self.access(caller, agent).await?;

        self.traces
            .get(agent, wake_id)
            .await
            .map_err(WakeError::Storage)?
            .ok_or(WakeError::NotFound)
    }
}

/// Check a record is a whole version 1 record and take out what the table
/// indexes.
fn validate(record: WakeRecord) -> Result<ValidWake, WakeError> {
    if record.v != 1 {
        return Err(WakeError::Invalid(format!(
            "record version {} is not 1",
            record.v
        )));
    }

    for (field, value) in [("wake", &record.wake), ("system", &record.system)] {
        if value.is_empty() || value.len() > MAX_NAME_LENGTH {
            return Err(WakeError::Invalid(format!(
                "{field} must be 1 to {MAX_NAME_LENGTH} characters"
            )));
        }
    }

    let started_at = DateTime::parse_from_rfc3339(&record.started_at)
        .map_err(|_| WakeError::Invalid("startedAt is not an ISO 8601 instant".to_owned()))?
        .to_utc();

    // `end` records carry the ending fields and no other phase does; the
    // record type flattens them, so check the pairing here.
    let status = match (record.phase, &record.end) {
        (WakePhase::End, Some(end)) => WakeStatus::from(end.status),
        (WakePhase::Start | WakePhase::Session, None) => WakeStatus::Running,
        (WakePhase::End, None) => {
            return Err(WakeError::Invalid(
                "an end record needs endedAt, durationMs, status, outcome and effects".to_owned(),
            ));
        }
        (WakePhase::Start | WakePhase::Session, Some(_)) => {
            return Err(WakeError::Invalid(
                "only an end record carries how the wake ended".to_owned(),
            ));
        }
    };

    Ok(ValidWake {
        phase: record.phase,
        status,
        started_at,
        record,
    })
}
