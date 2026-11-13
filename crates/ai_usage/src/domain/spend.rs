//! An agent account's AI spend, bucketed by calendar period for its dashboard.
//!
//! An agent account is a `User` with `isAgent`. Its spend is every priced
//! `ai_usage` row recorded against it, including rows its own provider API key
//! paid for (`agent_api_key_id`): those are real model spend, priced at the
//! same rates, and only excluded from Macro's quota counting.
//!
//! Who may read it: the agent itself, or an owner or admin of a team the agent
//! belongs to. A target that is not an agent account is readable only by
//! itself. Everyone else, and everyone the `enable-agent-dashboards` flag is
//! off for, is told the agent does not exist.

use chrono::{DateTime, Datelike, Days, Months, NaiveDate, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::ports::{Result, UsageError};

#[cfg(test)]
mod test;

/// The PostHog flag gating agent dashboards, for the caller. Keep in sync with
/// the web flag of the same key.
pub const ENABLE_AGENT_DASHBOARDS: &str = "enable-agent-dashboards";

/// The calendar period one spend bucket covers, in UTC.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum SpendBucket {
    /// One UTC day; the window is the last 30 days.
    #[default]
    Day,
    /// One ISO week, starting Monday; the window is the last 26 weeks.
    Week,
    /// One calendar month; the window is the last 12 months.
    Month,
    /// One calendar year; the window is the last 5 years.
    Year,
}

impl SpendBucket {
    /// How many buckets the window holds, the current partial one included.
    pub fn count(self) -> u32 {
        match self {
            Self::Day => 30,
            Self::Week => 26,
            Self::Month => 12,
            Self::Year => 5,
        }
    }

    /// The window ending at `now`: from the start of the oldest bucket, so
    /// every bucket is whole except the current one.
    pub fn window(self, now: DateTime<Utc>) -> Result<SpendWindow> {
        let today = now.date_naive();
        let older = self.count() - 1;
        let start = match self {
            Self::Day => today.checked_sub_days(Days::new(older.into())),
            Self::Week => {
                let monday = today
                    .checked_sub_days(Days::new(today.weekday().num_days_from_monday().into()));
                monday.and_then(|monday| monday.checked_sub_days(Days::new((older * 7).into())))
            }
            Self::Month => NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                .and_then(|first| first.checked_sub_months(Months::new(older))),
            Self::Year => i32::try_from(older)
                .ok()
                .and_then(|older| NaiveDate::from_ymd_opt(today.year() - older, 1, 1)),
        };
        let start =
            start.ok_or_else(|| UsageError::Other(anyhow::anyhow!("spend window out of range")))?;

        Ok(SpendWindow {
            bucket: self,
            from: start.and_time(chrono::NaiveTime::MIN).and_utc(),
            until: now,
        })
    }
}

/// A half-open UTC range `[from, until)` split into `bucket`-sized periods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpendWindow {
    /// The period each bucket covers.
    pub bucket: SpendBucket,
    /// Start of the oldest bucket (inclusive).
    pub from: DateTime<Utc>,
    /// End of the window (exclusive): the time of the request.
    pub until: DateTime<Utc>,
}

/// The cost recorded in one bucket.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpendPoint {
    /// Start of the bucket, in UTC.
    pub start: DateTime<Utc>,
    /// Sum of priced usage in the bucket, in USD.
    pub cost_usd: f64,
}

/// An agent's spend over a window: only buckets with priced usage, oldest first.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentSpend {
    /// The window the buckets fall in.
    pub window: SpendWindow,
    /// Non-empty buckets, oldest first.
    pub buckets: Vec<SpendPoint>,
}

/// Reads spend from storage.
pub trait AgentSpendRepo: Send + Sync + 'static {
    /// Priced usage recorded against `user` in `window`, summed per bucket.
    /// Only non-empty buckets, oldest first.
    fn spend_by_bucket(
        &self,
        user: &MacroUserIdStr<'_>,
        window: &SpendWindow,
    ) -> impl Future<Output = Result<Vec<SpendPoint>>> + Send;
}

/// Decides who manages an agent account.
pub trait AgentManagers: Send + Sync + 'static {
    /// True when `agent` is an agent account and `actor` is an owner or admin
    /// of a team it belongs to. False for unknown and non-agent accounts.
    fn manages_agent(
        &self,
        actor: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// The agent dashboards rollout.
pub trait AgentDashboardsGate: Send + Sync + 'static {
    /// True when [`ENABLE_AGENT_DASHBOARDS`] is on for `user`. A failed or
    /// unconfigured flag read is off.
    fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> impl Future<Output = bool> + Send;
}

/// The agent spend read, consumed by the inbound router.
pub trait AgentSpendService: Send + Sync + 'static {
    /// `agent`'s spend in the window of `bucket` ending now, or
    /// [`UsageError::NotFound`] when `actor` may not read it.
    fn agent_spend(
        &self,
        actor: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
        bucket: SpendBucket,
    ) -> impl Future<Output = Result<AgentSpend>> + Send;
}

/// [`AgentSpendService`] over its storage, access, and rollout ports.
pub struct AgentSpendServiceImpl<Repo, Managers, Gate> {
    repo: Repo,
    managers: Managers,
    gate: Gate,
}

impl<Repo, Managers, Gate> AgentSpendServiceImpl<Repo, Managers, Gate> {
    /// Construct the service.
    pub fn new(repo: Repo, managers: Managers, gate: Gate) -> Self {
        Self {
            repo,
            managers,
            gate,
        }
    }
}

impl<Repo, Managers, Gate> AgentSpendService for AgentSpendServiceImpl<Repo, Managers, Gate>
where
    Repo: AgentSpendRepo,
    Managers: AgentManagers,
    Gate: AgentDashboardsGate,
{
    // The agent id is an agent account's, not a person's; the actor is not
    // recorded.
    #[tracing::instrument(
        name = "ai_usage.agent_spend",
        skip_all,
        err,
        fields(agent_id = %agent, bucket = %bucket, bucket_count = tracing::field::Empty)
    )]
    async fn agent_spend(
        &self,
        actor: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
        bucket: SpendBucket,
    ) -> Result<AgentSpend> {
        if !self.gate.enabled_for(actor).await {
            return Err(UsageError::NotFound);
        }

        let readable = actor == agent || self.managers.manages_agent(actor, agent).await?;
        if !readable {
            return Err(UsageError::NotFound);
        }

        let window = bucket.window(Utc::now())?;
        let buckets = self.repo.spend_by_bucket(agent, &window).await?;
        tracing::Span::current().record("bucket_count", buckets.len());

        Ok(AgentSpend { window, buckets })
    }
}
