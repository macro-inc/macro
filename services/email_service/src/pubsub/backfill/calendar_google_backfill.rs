use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::cg_refresh_calendar;
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
    let report = ctx
        .calendar_backfills
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
        .map_err(map_run_error)?;
    // Quiet token-only polls change nothing; only real changes nudge
    // active viewers to refetch.
    if report.changed() {
        cg_refresh_calendar(
            &ctx.connection_gateway_client,
            &ctx.db,
            link.macro_id.as_ref(),
            link.id,
        )
        .await;
    }
    Ok(())
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
