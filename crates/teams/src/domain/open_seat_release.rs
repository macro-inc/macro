//! Outbound billing port for seat departure and paid-plan changes.
//!
//! The teams service uses this port to release that seat without depending on
//! a particular storage implementation.

use super::model::SeatPlan;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::convert::Infallible;

/// Original provider facts for a newly activated team subscription.
#[derive(Debug, Clone, Copy)]
pub struct SubscriptionStart {
    /// Original event time, retained on retries.
    pub at: DateTime<Utc>,
    /// Provider interval start.
    pub period_start: DateTime<Utc>,
    /// Provider interval end.
    pub period_end: DateTime<Utc>,
}

/// A team seat's transition into a paid plan.
#[derive(Debug, Clone, Copy)]
pub struct SeatPlanChange {
    /// Previous paid plan; None means Free.
    pub from: Option<SeatPlan>,
    /// Destination paid plan.
    pub to: SeatPlan,
    /// When the plan changed.
    pub at: DateTime<Utc>,
    /// Explicit provider interval for initial activation; otherwise billing resolves it.
    pub period: Option<(DateTime<Utc>, DateTime<Utc>)>,
}

/// Synchronizes team seat departures and plan changes with billing.
pub trait OpenSeatRelease: Clone + Send + Sync + 'static {
    /// Error returned when releasing an open seat fails.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Notify billing of a seat plan change after the provider accepted it.
    fn change_plan(
        &self,
        member: &MacroUserIdStr<'_>,
        change: SeatPlanChange,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Releases the open seat held by `member` on `team_id`.
    fn release(
        &self,
        team_id: uuid::Uuid,
        member: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// No-op open-seat release for callers that do not release seats.
#[derive(Clone, Debug)]
pub struct NoOpOpenSeatRelease;

impl OpenSeatRelease for NoOpOpenSeatRelease {
    type Err = Infallible;

    async fn change_plan(
        &self,
        _member: &MacroUserIdStr<'_>,
        _change: SeatPlanChange,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn release(
        &self,
        _team_id: uuid::Uuid,
        _member: &MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}
