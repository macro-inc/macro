//! Attendance evidence is separate from the host's explicit booking outcome.

use std::{collections::BTreeMap, future::Future, pin::Pin};

use uuid::Uuid;

use chrono::{DateTime, Utc};

use super::{
    models::{Booking, BookingAttendance, BookingRecord, BookingStatus, Error},
    service::Service,
};

/// Human participation observed in the Macro meeting during a booking's time window.
#[derive(Clone, Debug, Default)]
pub struct ObservedParticipants {
    /// Authenticated humans who connected, not accounts merely issued a join token.
    pub user_ids: Vec<String>,
    /// Whether a non-account guest connected.
    pub guest_present: bool,
}

/// Completion of an authorized booking-participation read.
pub type AttendanceFuture<'a> =
    Pin<Box<dyn Future<Output = Result<BTreeMap<Uuid, ObservedParticipants>, Error>> + Send + 'a>>;
/// Read-only participation evidence for already-authorized bookings.
pub trait AttendanceSource: Send + Sync {
    /// Return evidence by booking id; omit untracked meetings rather than inferring absence.
    fn observed_participants<'a>(&'a self, bookings: &'a [Booking]) -> AttendanceFuture<'a>;
}

impl<R, C, D> Service<R, C, D> {
    /// Derive returned outcomes without persisting over an explicit attendance choice.
    #[tracing::instrument(skip_all, err, fields(booking_count = records.len() as i64))]
    pub(super) async fn enrich_attendance(
        &self,
        records: &mut [BookingRecord],
        now: DateTime<Utc>,
    ) -> Result<(), Error> {
        let Some(source) = &self.attendance_source else {
            return Ok(());
        };
        let bookings: Vec<_> = records
            .iter()
            .filter(|record| {
                record.event.macro_call
                    && record.booking.status == BookingStatus::Confirmed
                    && record.booking.ends_at <= now
                    && record.booking.attendance == BookingAttendance::Unknown
            })
            .map(|record| record.booking.clone())
            .collect();
        if bookings.is_empty() {
            return Ok(());
        }
        let evidence = source.observed_participants(&bookings).await?;
        let outcomes: BTreeMap<_, _> = bookings
            .iter()
            .filter_map(|booking| {
                evidence
                    .get(&booking.id)
                    .map(|people| (booking.id, people.outcome(booking)))
            })
            .collect();
        for record in records {
            if let Some(outcome) = outcomes.get(&record.booking.id) {
                record.booking.attendance = *outcome;
            }
        }
        Ok(())
    }
}

impl ObservedParticipants {
    fn outcome(&self, booking: &Booking) -> BookingAttendance {
        let host_present = self.user_ids.iter().any(|id| booking.hosts.contains(id));
        let guest_present =
            self.guest_present || self.user_ids.iter().any(|id| !booking.hosts.contains(id));
        match (host_present, guest_present) {
            (true, true) => BookingAttendance::Attended,
            (true, false) => BookingAttendance::GuestNoShow,
            (false, true) => BookingAttendance::HostNoShow,
            (false, false) => BookingAttendance::Unknown,
        }
    }
}
