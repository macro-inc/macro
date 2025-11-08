use crate::email::service::backfill as service_backfill;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
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
    // Number of threads that have been processed (succeeded + failed + skipped)
    pub threads_processed_count: i32,

    // Total number of messages we pull from gmail api during backfill
    pub messages_retrieved_count: i32,
    // Number of messages that either succeeded or failed
    pub messages_processed_count: i32,

    // Number of threads that were successfully backfilled
    pub threads_succeeded_count: i32,
    // Number of threads that were skipped during backfill due to already existing
    pub threads_skipped_count: i32,
    // Number of threads that failed during backfill
    pub threads_failed_count: i32,

    // Number of messages successfully backfilled
    pub messages_succeeded_count: i32,
    // Number of messages that failed during backfill
    pub messages_failed_count: i32,

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

// Struct for backfill thread (Service layer)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackfillThread {
    pub backfill_job_id: Uuid,
    pub thread_provider_id: String,
    pub messages_retrieved_count: i32,
    pub messages_processed_count: i32,
    pub messages_succeeded_count: i32,
    pub messages_failed_count: i32,
    pub metadata_updated: bool,
    pub status: BackfillThreadStatus,
    pub error_message: Option<String>,
    pub retry_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// Enum for backfill message status
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
#[sqlx(type_name = "email_backfill_message_status", rename_all = "PascalCase")]
pub enum BackfillMessageStatus {
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

// Struct for the backfill_message table
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackfillMessage {
    pub backfill_job_id: Uuid,
    pub thread_provider_id: String,
    pub message_provider_id: String,
    pub status: BackfillMessageStatus,
    pub error_message: Option<String>,
    pub retry_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
            messages_retrieved_count: job.messages_retrieved_count,

            // Thread-Level Progress
            threads_processed_count: job.threads_processed_count,
            threads_succeeded_count: job.threads_succeeded_count,
            threads_failed_count: job.threads_failed_count,
            threads_skipped_count: job.threads_skipped_count,

            // Message-Level Progress
            messages_processed_count: job.messages_processed_count,
            messages_succeeded_count: job.messages_succeeded_count,
            messages_failed_count: job.messages_failed_count,

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

impl From<service_backfill::BackfillThread> for BackfillThread {
    fn from(thread: service_backfill::BackfillThread) -> Self {
        BackfillThread {
            backfill_job_id: thread.backfill_job_id,
            thread_provider_id: thread.thread_provider_id,
            messages_retrieved_count: thread.messages_retrieved_count,
            messages_processed_count: thread.messages_processed_count,
            messages_succeeded_count: thread.messages_succeeded_count,
            messages_failed_count: thread.messages_failed_count,
            metadata_updated: thread.metadata_updated,
            status: thread.status.into(),
            error_message: thread.error_message,
            retry_count: thread.retry_count,
            created_at: thread.created_at,
            updated_at: thread.updated_at,
        }
    }
}

impl From<service_backfill::BackfillMessageStatus> for BackfillMessageStatus {
    fn from(status: service_backfill::BackfillMessageStatus) -> Self {
        match status {
            service_backfill::BackfillMessageStatus::InProgress => {
                BackfillMessageStatus::InProgress
            }
            service_backfill::BackfillMessageStatus::Completed => BackfillMessageStatus::Completed,
            service_backfill::BackfillMessageStatus::Failed => BackfillMessageStatus::Failed,
            service_backfill::BackfillMessageStatus::Cancelled => BackfillMessageStatus::Cancelled,
        }
    }
}

impl From<service_backfill::BackfillMessage> for BackfillMessage {
    fn from(message: service_backfill::BackfillMessage) -> Self {
        BackfillMessage {
            backfill_job_id: message.backfill_job_id,
            thread_provider_id: message.thread_provider_id,
            message_provider_id: message.message_provider_id,
            status: message.status.into(),
            error_message: message.error_message,
            retry_count: message.retry_count,
            created_at: message.created_at,
            updated_at: message.updated_at,
        }
    }
}

#[derive(Debug, FromRow)]
pub struct BackfillJobCounters {
    pub total_threads: i32,
    pub threads_processed_count: i32,
}

impl From<service_backfill::BackfillJobCounters> for BackfillJobCounters {
    fn from(counters: service_backfill::BackfillJobCounters) -> Self {
        BackfillJobCounters {
            total_threads: counters.total_threads,
            threads_processed_count: counters.threads_processed_count,
        }
    }
}

#[derive(Debug, FromRow)]
pub struct BackfillThreadCounters {
    pub messages_retrieved_count: i32,
    pub messages_processed_count: i32,
    pub messages_succeeded_count: i32,
    pub messages_failed_count: i32,
}

impl From<service_backfill::BackfillThreadCounters> for BackfillThreadCounters {
    fn from(counters: service_backfill::BackfillThreadCounters) -> Self {
        BackfillThreadCounters {
            messages_retrieved_count: counters.messages_retrieved_count,
            messages_processed_count: counters.messages_processed_count,
            messages_succeeded_count: counters.messages_succeeded_count,
            messages_failed_count: counters.messages_failed_count,
        }
    }
}
