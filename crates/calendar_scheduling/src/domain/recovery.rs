//! Durable provider-operation recovery and completion fencing.
use super::{models::*, ports::*, service::Service};
use chrono::{Duration, Utc};
use uuid::Uuid;

impl CalendarOperation {
    /// Start a recoverable operation; the grace period exceeds provider request timeouts.
    pub fn new(kind: CalendarOperationKind) -> Self {
        Self {
            id: Uuid::now_v7(),
            attempt: 0,
            retry_at: Utc::now() + Duration::minutes(5),
            kind,
            abandoned_at: None,
            unsent: false,
        }
    }
}
impl<R: Repository, C: Calendars, D: Directory> Service<R, C, D> {
    /// Resume one overdue operation. Multiple replicas claim separate rows atomically.
    #[tracing::instrument(skip(self), err)]
    pub async fn recover_once(&self) -> Result<bool, Error> {
        let Some(record) = self.repository.claim_recovery().await? else {
            return Ok(false);
        };
        let id = record.booking.id;
        let attempt = record.operation.as_ref().map_or(0, |op| op.attempt);
        let result = self.finish_operation(record).await?;
        if matches!(
            result.booking.status,
            BookingStatus::Failed | BookingStatus::Processing
        ) {
            return Ok(true);
        }
        tracing::info!(booking_id = %id, attempt, "scheduling operation recovered");
        Ok(true)
    }

    pub(super) async fn finish_operation(
        &self,
        mut record: BookingRecord,
    ) -> Result<BookingRecord, Error> {
        let operation = record.operation.clone().ok_or(Error::Conflict)?;
        let result = match operation.kind {
            CalendarOperationKind::Create => self
                .calendars
                .create(&record, &record.event)
                .await
                .map(|(id, location)| {
                    record.calendar_event_id = Some(id);
                    record.booking.location = location;
                    record.booking.status = BookingStatus::Confirmed;
                }),
            CalendarOperationKind::Move {
                status,
                original_start,
            } => self.calendars.reschedule(&record).await.map(|()| {
                record.booking.status = status;
                if record.booking.starts_at != original_start {
                    record.booking.reschedule_count =
                        record.booking.reschedule_count.saturating_add(1);
                    record.booking.rescheduled_at = Some(Utc::now());
                    record.booking.attendance = BookingAttendance::Unknown;
                }
            }),
            CalendarOperationKind::Cancel => self.calendars.cancel(&record).await.map(|()| {
                record.booking.status = BookingStatus::Cancelled;
            }),
        };
        if let Err(error) = result {
            // A refusal is decided before anything reaches the calendar, so a
            // move refused on its first attempt left the event where it was:
            // put the booking back at that time and release the time it asked
            // for. A later attempt follows one whose outcome was never
            // recorded and may have moved the event, so it is only abandoned.
            if let (
                Error::CalendarRejected,
                CalendarOperationKind::Move {
                    status,
                    original_start,
                },
                0,
            ) = (&error, &operation.kind, operation.attempt)
            {
                let pending = record.clone();
                let length = record.booking.ends_at - record.booking.starts_at;
                record.booking.starts_at = *original_start;
                record.booking.ends_at = *original_start + length;
                record.busy_start = record.booking.starts_at
                    - Duration::minutes(i64::from(record.event.before_minutes));
                record.busy_end = record.booking.ends_at
                    + Duration::minutes(i64::from(record.event.after_minutes));
                record.booking.status = *status;
                tracing::warn!(booking_id = %record.booking.id, error = ?error, "scheduling move refused; booking kept at its original time");
                // Only a saved revert answers the caller with the refusal; an
                // unsaved one returns the move storage still holds.
                return match self
                    .repository
                    .update_booking(record, BookingStatus::Processing)
                    .await
                {
                    Ok(_) => Err(Error::CalendarRejected),
                    Err(error) => self.unsaved_completion(pending, error).await,
                };
            }
            record.booking.status = BookingStatus::Failed;
            // A failure that may still clear is retried until the meeting
            // starts: an event in the past is not worth creating or moving.
            if matches!(error, Error::CalendarRejected) || record.booking.starts_at <= Utc::now() {
                let now = Utc::now();
                if let Some(op) = &mut record.operation {
                    op.abandoned_at = Some(now);
                    // A refusal is decided before anything reaches the
                    // calendar, and a first attempt has nothing before it.
                    op.unsent = operation.attempt == 0 && matches!(error, Error::CalendarRejected);
                }
                record.booking.abandoned_at = Some(now);
                tracing::error!(booking_id = %record.booking.id, attempt = operation.attempt, error = ?error, "scheduling operation abandoned; booking left failed");
                return self.persist_completion(record).await;
            }
            // Keep both reservations after an uncertain move. Never expose an occupied slot.
            let minutes = 5_i64 * 2_i64.pow(operation.attempt.min(4));
            if let Some(op) = &mut record.operation {
                op.retry_at = Utc::now() + Duration::minutes(minutes.min(60));
            }
            tracing::warn!(booking_id = %record.booking.id, attempt = operation.attempt, error = ?error, "scheduling operation queued for recovery");
            // Reservation is durable: return its receipt even when the provider is uncertain.
            // A guest must not be encouraged to create a second booking.
            return self.persist_completion(record).await;
        }
        self.persist_completion(record).await
    }

    async fn persist_completion(&self, record: BookingRecord) -> Result<BookingRecord, Error> {
        match self
            .repository
            .update_booking(record.clone(), BookingStatus::Processing)
            .await
        {
            Ok(saved) => Ok(saved),
            Err(error) => self.unsaved_completion(record, error).await,
        }
    }
    /// The receipt for a completion that was not saved: the stored row when a
    /// later writer owns it, otherwise `record` still processing.
    async fn unsaved_completion(
        &self,
        mut record: BookingRecord,
        error: Error,
    ) -> Result<BookingRecord, Error> {
        match error {
            Error::Conflict => {
                // A recovery worker or later edit owns the revision now. The original
                // reservation still exists, so this is not a rejected booking attempt.
                if let Ok(Some(current)) = self.repository.booking(record.booking.id).await {
                    return Ok(current);
                }
                record.booking.status = BookingStatus::Processing;
                record.booking.abandoned_at = None;
                Ok(record)
            }
            Error::Unavailable => {
                // The reservation and intent predate the provider call. Keep its private receipt
                // available even when the completion write is uncertain; recovery owns convergence.
                tracing::error!(booking_id = %record.booking.id, "scheduling completion persistence unavailable; intent retained");
                // The stored row is still processing; an unsaved abandonment
                // must not reach the receipt.
                record.booking.status = BookingStatus::Processing;
                record.booking.abandoned_at = None;
                Ok(record)
            }
            error => Err(error),
        }
    }
}
