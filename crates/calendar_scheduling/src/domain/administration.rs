//! Authorized scheduling operations exposed to administration clients.
use super::{
    insights::{BookingInsights, InsightQuery},
    management::BookingChange,
    models::*,
    ports::*,
    service::Service,
};
use chrono::{DateTime, NaiveDate, Utc};
use std::future::Future;
use uuid::Uuid;

/// Scheduling administration; implementations preserve the owning service's policy.
pub trait SchedulingAdministration: Send + Sync + 'static {
    /// Read a personal or team profile without creating it.
    fn settings(
        &self,
        user: &str,
        team: Option<Uuid>,
    ) -> impl Future<Output = Result<Profile, Error>> + Send;
    /// Save at the supplied revision, requiring owner/admin access.
    fn save(
        &self,
        user: &str,
        team: Option<Uuid>,
        profile: Profile,
    ) -> impl Future<Output = Result<Profile, Error>> + Send;
    /// Read all authorized bookings in a half-open range, or fail on overflow.
    fn bookings_in_range(
        &self,
        user: &str,
        team: Option<Uuid>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<Booking>, Error>> + Send;
    /// Read filtered metrics for current and previous local-calendar periods.
    fn booking_insights(
        &self,
        user: &str,
        team: Option<Uuid>,
        query: InsightQuery,
    ) -> impl Future<Output = Result<BookingInsights, Error>> + Send;
    /// Apply an authorized booking lifecycle change.
    fn change_booking(
        &self,
        user: &str,
        id: Uuid,
        change: BookingChange,
    ) -> impl Future<Output = Result<Booking, Error>> + Send;
    /// Discover replacement times as the profile owner/admin.
    fn host_replacement_slots(
        &self,
        user: &str,
        id: Uuid,
        date: NaiveDate,
    ) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send;
}
impl<R: Repository, C: Calendars, D: Directory> SchedulingAdministration for Service<R, C, D> {
    async fn settings(&self, user: &str, team: Option<Uuid>) -> Result<Profile, Error> {
        self.settings(user, team).await
    }
    async fn save(
        &self,
        user: &str,
        team: Option<Uuid>,
        profile: Profile,
    ) -> Result<Profile, Error> {
        self.save(user, team, profile).await
    }
    async fn bookings_in_range(
        &self,
        user: &str,
        team: Option<Uuid>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<Booking>, Error> {
        self.bookings_in_range(user, team, from, to).await
    }
    async fn booking_insights(
        &self,
        user: &str,
        team: Option<Uuid>,
        query: InsightQuery,
    ) -> Result<BookingInsights, Error> {
        self.booking_insights(user, team, query).await
    }
    async fn change_booking(
        &self,
        user: &str,
        id: Uuid,
        change: BookingChange,
    ) -> Result<Booking, Error> {
        self.change_booking(user, id, change).await
    }
    async fn host_replacement_slots(
        &self,
        user: &str,
        id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<Slot>, Error> {
        self.host_replacement_slots(user, id, date).await
    }
}
