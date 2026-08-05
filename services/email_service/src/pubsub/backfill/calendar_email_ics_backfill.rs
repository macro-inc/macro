use crate::pubsub::context::PubSubContext;
use calendar_events::domain::{
    models::CalendarBackfillJobKey, service::EmailCalendarBackfillRunError,
};
use models_email::email::service::{
    backfill::CalendarBackfillPayload,
    link::Link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};

/// Invoke the calendar application service for one email-ICS backfill delivery.
#[tracing::instrument(skip(ctx, link), fields(calendar_job_id = %payload.calendar_job_id))]
pub async fn calendar_email_ics_backfill(
    ctx: &PubSubContext,
    link: &Link,
    payload: &CalendarBackfillPayload,
) -> Result<(), ProcessingError> {
    ctx.calendar_backfills
        .email_ics
        .run(
            CalendarBackfillJobKey {
                job_id: payload.calendar_job_id,
                email_link_id: link.id,
            },
            link.fusionauth_user_id.as_str(),
        )
        .await
        .map_err(map_run_error)
}

fn map_run_error(error: EmailCalendarBackfillRunError) -> ProcessingError {
    let retryable = matches!(
        error,
        EmailCalendarBackfillRunError::Busy | EmailCalendarBackfillRunError::Retryable(_)
    );
    let reason = match &error {
        EmailCalendarBackfillRunError::Busy => FailureReason::CalendarBackfillBusy,
        EmailCalendarBackfillRunError::NotFound => FailureReason::BackfillJobNotFound,
        EmailCalendarBackfillRunError::ScanFailed => FailureReason::InvalidData,
        EmailCalendarBackfillRunError::Retryable(_) => FailureReason::DatabaseQueryFailed,
    };
    let detailed = DetailedError {
        reason,
        source: anyhow::Error::new(error),
    };
    if retryable {
        ProcessingError::Retryable(detailed)
    } else {
        ProcessingError::NonRetryable(detailed)
    }
}
