use crate::pubsub::context::PubSubContext;
use calendar_events::domain::{
    models::{CalendarBackfillJobKey, OccurrenceRange},
    service::GoogleCalendarBackfillRunError,
};
use chrono::Utc;
use models_email::email::service::{
    backfill::CalendarBackfillPayload,
    link::Link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};

/// Invoke the calendar application service for one Google backfill delivery.
#[tracing::instrument(skip(ctx, access_token, link), fields(calendar_job_id = %payload.calendar_job_id))]
pub async fn calendar_google_backfill(
    ctx: &PubSubContext,
    access_token: &str,
    link: &Link,
    payload: &CalendarBackfillPayload,
) -> Result<(), ProcessingError> {
    ctx.calendar_backfills
        .google
        .run(
            CalendarBackfillJobKey {
                job_id: payload.calendar_job_id,
                email_link_id: link.id,
            },
            link.macro_id.as_ref(),
            access_token,
            OccurrenceRange::maintenance_horizon(Utc::now()),
        )
        .await
        .map(|_| ())
        .map_err(map_run_error)
}

fn map_run_error(error: GoogleCalendarBackfillRunError) -> ProcessingError {
    let retryable = matches!(
        error,
        GoogleCalendarBackfillRunError::Busy
            | GoogleCalendarBackfillRunError::LeaseLost
            | GoogleCalendarBackfillRunError::Retryable(_)
    );
    let reason = match &error {
        GoogleCalendarBackfillRunError::Busy | GoogleCalendarBackfillRunError::LeaseLost => {
            FailureReason::CalendarBackfillBusy
        }
        GoogleCalendarBackfillRunError::NotFound => FailureReason::BackfillJobNotFound,
        GoogleCalendarBackfillRunError::ReauthRequired { .. } => {
            FailureReason::AccessTokenFetchFailed
        }
        GoogleCalendarBackfillRunError::AlreadyFailed
        | GoogleCalendarBackfillRunError::Permanent(_) => FailureReason::InvalidData,
        GoogleCalendarBackfillRunError::Retryable(_) => FailureReason::GmailApiFailed,
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
