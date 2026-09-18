//! Persistence and calendar capabilities required by scheduling policy.
use super::models::*;
use chrono::{DateTime, Utc};
use std::future::Future;
use uuid::Uuid;

/// Scheduling's durable store. Reservations are atomic across all profiles and hosts.
pub trait Repository: Send + Sync + 'static {
    /// Consume a shared per-profile public API budget, failing closed on storage errors.
    fn consume_budget(
        &self,
        profile: Uuid,
        budget: PublicBudget,
    ) -> impl Future<Output = Result<(), Error>> + Send;
    /// Atomically claim one overdue operation and increment its completion fence.
    fn claim_recovery(&self) -> impl Future<Output = Result<Option<BookingRecord>, Error>> + Send;
    /// Read a profile, including its ownership boundary.
    fn profile(&self, id: Uuid)
    -> impl Future<Output = Result<Option<OwnedProfile>, Error>> + Send;
    /// Create or compare-and-swap a profile at its supplied revision.
    fn save_profile(
        &self,
        profile: OwnedProfile,
    ) -> impl Future<Output = Result<Profile, Error>> + Send;
    /// List every profile booking in a half-open range, or fail explicitly on overflow.
    fn bookings(
        &self,
        profile: Uuid,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<BookingRecord>, Error>> + Send;
    /// Read all active host claims, including those owned by other profiles.
    fn busy(
        &self,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<BusyRange>, Error>> + Send;
    /// Reserve host ranges atomically; enforce the daily limit and idempotency.
    fn reserve(
        &self,
        record: BookingRecord,
        limit: Option<u16>,
        day_start: DateTime<Utc>,
        day_end: DateTime<Utc>,
    ) -> impl Future<Output = Result<BookingRecord, Error>> + Send;
    /// Load a booking by identity.
    fn booking(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<BookingRecord>, Error>> + Send;
    /// Resolve a retry before rechecking the now-occupied slot.
    fn booking_request(
        &self,
        request: Uuid,
    ) -> impl Future<Output = Result<Option<BookingRecord>, Error>> + Send;
    /// Atomically protect both old and new ranges while a reschedule is processed.
    fn move_booking(
        &self,
        record: BookingRecord,
        expected: BookingStatus,
        day_start: DateTime<Utc>,
        day_end: DateTime<Utc>,
    ) -> impl Future<Output = Result<BookingRecord, Error>> + Send;
    /// Compare-and-swap a booking and release cancelled claims in the same transaction.
    fn update_booking(
        &self,
        record: BookingRecord,
        expected: BookingStatus,
    ) -> impl Future<Output = Result<BookingRecord, Error>> + Send;
}
/// Calendar adapter, implemented with the existing calendar domain services.
pub trait Calendars: Send + Sync + 'static {
    /// Select and pin the organizer's writable primary calendar before reserving.
    fn creation_calendar(&self, host: &str) -> impl Future<Output = Result<Uuid, Error>> + Send;
    /// Load authoritative busy time, failing closed for disconnected or syncing hosts.
    fn busy(
        &self,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude_event: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<BusyRange>, Error>> + Send;
    /// Create the organizer's provider event and invite all assigned hosts and the booker.
    fn create(
        &self,
        record: &BookingRecord,
        event: &EventType,
    ) -> impl Future<Output = Result<(Uuid, String), Error>> + Send;
    /// Cancel the provider event, notifying attendees through the calendar integration.
    fn cancel(&self, record: &BookingRecord) -> impl Future<Output = Result<(), Error>> + Send;
    /// Move an existing provider event without creating a second invitation.
    fn reschedule(&self, record: &BookingRecord) -> impl Future<Output = Result<(), Error>> + Send;
}
/// Membership facts supplied by Macro's teams domain.
pub trait Directory: Send + Sync + 'static {
    /// All current members, including the owner.
    fn members(&self, team: Uuid) -> impl Future<Output = Result<Vec<TeamMember>, Error>> + Send;
}
