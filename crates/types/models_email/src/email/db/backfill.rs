use crate::email::service::backfill as service_backfill;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use strum::{AsRefStr, Display, EnumString};
use uuid::Uuid;

// Enum for backfill job status
#[derive(
    Debug,
    Serialize,
    Deserialize,
    sqlx::Type,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumString,
    AsRefStr,
    Display,
)]
#[sqlx(type_name = "email_backfill_job_status", rename_all = "PascalCase")]
pub enum BackfillJobStatus {
    // The status a job is in from job creation until we start to list threads for backfill.
    Init,
    InProgress,
    Complete,
    Cancelled,
    Failed,
}

// Struct for the backfill_job table
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackfillJob {
    pub id: Uuid,
    pub link_id: Option<Uuid>,
    // We store the fusionauth_user_id in case the user's link_id is deleted. We use the fusionauth_user_id to see all
    // the jobs for a single macro user, as link_id is changed each time it is deleted and recreated.
    pub fusionauth_user_id: String,
    // The number of threads requested by the user for backfill. None means all.
    pub threads_requested_limit: Option<i32>,

    // Number of threads that will be processed during backfill. This value is determined by either:
    // 1. The minimum between user-requested threads and total available threads, if a limit was specified
    // 2. The total number of threads in the user's account if no limit was specified
    pub total_threads: i32,

    // The status of the backfill job.
    pub status: BackfillJobStatus,

    // Total number of threads we pulled from gmail api during backfill
    pub threads_retrieved_count: i32,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// Enum for backfill thread status
#[derive(
    Debug,
    Serialize,
    Deserialize,
    sqlx::Type,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumString,
    AsRefStr,
    Display,
)]
#[sqlx(type_name = "email_backfill_thread_status", rename_all = "PascalCase")]
pub enum BackfillThreadStatus {
    InProgress,
    Skipped,
    Completed,
    Failed,
    Cancelled,
}

impl From<service_backfill::BackfillJobStatus> for BackfillJobStatus {
    fn from(status: service_backfill::BackfillJobStatus) -> Self {
        match status {
            service_backfill::BackfillJobStatus::Init => BackfillJobStatus::Init,
            service_backfill::BackfillJobStatus::InProgress => BackfillJobStatus::InProgress,
            service_backfill::BackfillJobStatus::Complete => BackfillJobStatus::Complete,
            service_backfill::BackfillJobStatus::Cancelled => BackfillJobStatus::Cancelled,
            service_backfill::BackfillJobStatus::Failed => BackfillJobStatus::Failed,
        }
    }
}

impl From<service_backfill::BackfillJob> for BackfillJob {
    fn from(job: service_backfill::BackfillJob) -> Self {
        BackfillJob {
            id: job.id,
            link_id: job.link_id,
            fusionauth_user_id: job.fusionauth_user_id,
            threads_requested_limit: job.threads_requested_limit,

            // Ground Truth Counters
            total_threads: job.total_threads,
            threads_retrieved_count: job.threads_retrieved_count,

            // Job Metadata
            status: job.status.into(),
            created_at: job.created_at,
            updated_at: job.updated_at,
        }
    }
}

impl From<service_backfill::BackfillThreadStatus> for BackfillThreadStatus {
    fn from(status: service_backfill::BackfillThreadStatus) -> Self {
        match status {
            service_backfill::BackfillThreadStatus::InProgress => BackfillThreadStatus::InProgress,
            service_backfill::BackfillThreadStatus::Skipped => BackfillThreadStatus::Skipped,
            service_backfill::BackfillThreadStatus::Completed => BackfillThreadStatus::Completed,
            service_backfill::BackfillThreadStatus::Failed => BackfillThreadStatus::Failed,
            service_backfill::BackfillThreadStatus::Cancelled => BackfillThreadStatus::Cancelled,
        }
    }
}
