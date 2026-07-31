//! Database and queue adapters for email-based calendar extraction.

use calendar_events::domain::{
    models::{
        CalendarBackfillJobKey, EmailCalendarBackfillState, EmailCalendarScanAssociation,
        EmailCalendarScanJob, EmailCalendarScanStatus,
    },
    ports::{
        EmailCalendarBackfillPublisher, EmailCalendarBackfillRepository, GoogleProviderError,
        GoogleProviderErrorKind,
    },
};
use calendar_events::outbound::google::GoogleRequestGate;

use crate::util::redis::RedisClient;

/// Enforces the per-inbox Google Calendar API quota before each request.
#[derive(Clone)]
pub struct RedisCalendarRequestGate {
    redis: RedisClient,
}

impl RedisCalendarRequestGate {
    /// Construct the gate over the process-level Redis client.
    pub fn new(redis: RedisClient) -> Self {
        Self { redis }
    }
}

impl GoogleRequestGate for RedisCalendarRequestGate {
    async fn acquire(&self, email_link_id: Uuid) -> Result<(), GoogleProviderError> {
        if self.redis.is_calendar_rate_limited(email_link_id).await {
            return Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Transient,
                "Google Calendar API rate limit reached for this inbox",
            ));
        }
        Ok(())
    }
}
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
};
use rootcause::Report;
use sqlx::PgPool;
use sqs_client::SQS;
use uuid::Uuid;

/// MacroDB implementation of the email calendar-backfill repository.
#[derive(Clone)]
pub struct PgEmailCalendarBackfillRepository {
    pool: PgPool,
}

impl PgEmailCalendarBackfillRepository {
    /// Construct the repository from the shared MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl EmailCalendarBackfillRepository for PgEmailCalendarBackfillRepository {
    async fn get_email_calendar_backfill_state(
        &self,
        key: CalendarBackfillJobKey,
    ) -> Result<EmailCalendarBackfillState, Report> {
        let row = sqlx::query!(
            r#"
            SELECT
                status,
                (cursor->>'emailBackfillJobId')::uuid AS email_job_id
            FROM calendar_backfill_jobs
            WHERE id = $1
              AND email_link_id = $2
              AND kind = 'email_ics'
            "#,
            key.job_id,
            key.email_link_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(report)?;
        Ok(match row {
            None => EmailCalendarBackfillState::NotFound,
            Some(row) if row.status == "complete" => EmailCalendarBackfillState::Complete,
            Some(row) => row
                .email_job_id
                .map(|email_job_id| EmailCalendarBackfillState::Associated { email_job_id })
                .unwrap_or(EmailCalendarBackfillState::Unassociated),
        })
    }

    async fn get_email_scan_job(
        &self,
        email_link_id: Uuid,
        email_job_id: Uuid,
    ) -> Result<Option<EmailCalendarScanJob>, Report> {
        email_db_client::backfill::job::get::get_backfill_job_with_link_id(
            &self.pool,
            email_job_id,
            email_link_id,
        )
        .await
        .map(|job| job.map(to_scan_job))
        .map_err(report)
    }

    async fn get_active_email_scan_job(
        &self,
        email_link_id: Uuid,
    ) -> Result<Option<EmailCalendarScanJob>, Report> {
        email_db_client::backfill::job::get::get_active_backfill_job(&self.pool, email_link_id)
            .await
            .map(|job| job.map(to_scan_job))
            .map_err(report)
    }

    async fn create_email_scan_job(
        &self,
        email_link_id: Uuid,
        fusionauth_user_id: &str,
    ) -> Result<EmailCalendarScanJob, Report> {
        if let Some(job) = email_db_client::backfill::job::insert::create_backfill_job(
            &self.pool,
            email_link_id,
            fusionauth_user_id,
            None,
        )
        .await
        .map_err(report)?
        {
            return Ok(to_scan_job(job));
        }
        email_db_client::backfill::job::get::get_active_backfill_job(&self.pool, email_link_id)
            .await
            .map_err(report)?
            .map(to_scan_job)
            .ok_or_else(|| {
                rootcause::report!("email backfill insert conflicted without an active job")
            })
    }

    async fn associate_email_scan(
        &self,
        key: CalendarBackfillJobKey,
        email_job_id: Uuid,
        allow_in_progress: bool,
    ) -> Result<EmailCalendarScanAssociation, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        let email_status = sqlx::query_scalar!(
            r#"
            SELECT status::text AS "status!"
            FROM email_backfill_jobs
            WHERE id = $1
              AND link_id = $2
            FOR UPDATE
            "#,
            email_job_id,
            key.email_link_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;
        let Some(email_status) = email_status else {
            tx.commit().await.map_err(report)?;
            return Ok(EmailCalendarScanAssociation::NotFound);
        };
        let scan_status = parse_scan_status(&email_status)?;
        if scan_status == EmailCalendarScanStatus::InProgress && !allow_in_progress {
            tx.commit().await.map_err(report)?;
            return Ok(EmailCalendarScanAssociation::Busy);
        }
        let (calendar_status, completed, last_error) = match scan_status {
            EmailCalendarScanStatus::Init | EmailCalendarScanStatus::InProgress => {
                ("running", false, None)
            }
            EmailCalendarScanStatus::Complete => ("complete", true, None),
            EmailCalendarScanStatus::Failed => (
                "failed",
                true,
                Some("associated email backfill ended before extraction completed"),
            ),
        };
        let updated = sqlx::query!(
            r#"
            UPDATE calendar_backfill_jobs
            SET status = $2,
                started_at = COALESCE(started_at, now()),
                completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
                cursor = jsonb_build_object('emailBackfillJobId', $4::uuid),
                last_error = $5,
                updated_at = now()
            WHERE id = $1
              AND email_link_id = $6
              AND kind = 'email_ics'
              AND status <> 'complete'
            "#,
            key.job_id,
            calendar_status,
            completed,
            email_job_id,
            last_error,
            key.email_link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        if updated.rows_affected() == 0 && calendar_status != "complete" {
            tx.commit().await.map_err(report)?;
            return Ok(EmailCalendarScanAssociation::NotFound);
        }
        tx.commit().await.map_err(report)?;
        Ok(EmailCalendarScanAssociation::Associated(scan_status))
    }

    async fn fail_email_calendar_backfill(
        &self,
        key: CalendarBackfillJobKey,
        message: &str,
    ) -> Result<bool, Report> {
        email_db_client::backfill::job::update::fail_email_ics_calendar_backfill_job(
            &self.pool,
            key.job_id,
            key.email_link_id,
            message,
        )
        .await
        .map_err(report)
    }
}

/// SQS implementation of email scan initialization publication.
#[derive(Clone)]
pub struct SqsEmailCalendarBackfillPublisher {
    sqs: SQS,
}

impl SqsEmailCalendarBackfillPublisher {
    /// Construct a publisher for the established email backfill queue.
    pub fn new(sqs: SQS) -> Self {
        Self { sqs }
    }
}

impl EmailCalendarBackfillPublisher for SqsEmailCalendarBackfillPublisher {
    async fn publish_email_scan_init(
        &self,
        email_link_id: Uuid,
        email_job_id: Uuid,
    ) -> Result<(), Report> {
        self.sqs
            .enqueue_email_backfill_message(BackfillPubsubMessage {
                backfill_operation: BackfillOperation::Init(JobScopedPayload {
                    link_id: email_link_id,
                    job_id: email_job_id,
                    payload: InitPayload {},
                }),
            })
            .await
            .map_err(report)
    }
}

fn to_scan_job(job: models_email::email::service::backfill::BackfillJob) -> EmailCalendarScanJob {
    EmailCalendarScanJob {
        id: job.id,
        status: match job.status {
            BackfillJobStatus::Init => EmailCalendarScanStatus::Init,
            BackfillJobStatus::InProgress => EmailCalendarScanStatus::InProgress,
            BackfillJobStatus::Complete => EmailCalendarScanStatus::Complete,
            BackfillJobStatus::Cancelled | BackfillJobStatus::Failed => {
                EmailCalendarScanStatus::Failed
            }
        },
        is_full_scan: job.threads_requested_limit.is_none(),
    }
}

fn parse_scan_status(status: &str) -> Result<EmailCalendarScanStatus, Report> {
    match status {
        "Init" => Ok(EmailCalendarScanStatus::Init),
        "InProgress" => Ok(EmailCalendarScanStatus::InProgress),
        "Complete" => Ok(EmailCalendarScanStatus::Complete),
        "Cancelled" | "Failed" => Ok(EmailCalendarScanStatus::Failed),
        _ => Err(rootcause::report!(
            "unsupported email backfill status: {status}"
        )),
    }
}

fn report(error: impl std::fmt::Debug) -> Report {
    rootcause::report!("{error:?}")
}
