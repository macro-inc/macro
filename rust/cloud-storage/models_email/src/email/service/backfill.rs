use crate::email::db::backfill as db_backfill;
use crate::email::service::thread::ListThreadsPayload;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use strum::{AsRefStr, Display, EnumString};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct BackfillThreadPayload {
    pub thread_provider_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct BackfillMessagePayload {
    pub thread_provider_id: String,
    pub thread_db_id: Uuid,
    pub message_provider_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackfillOperation {
    // Populates total_threads and sends the first ListThreads message
    Init,
    // Each ListThreads operation gets a batch of 500 thread_ids from the gmail api
    // and sends a BackfillThread message for each thread_id in the batch. If there
    // are still threads left to fetch, it will send another ListThreads message.
    ListThreads(ListThreadsPayload),
    // Creates the thread object in the database, fetches the message ids for the thread
    // from the gmail api, and sends a BackfillMessage message for each message_id.
    BackfillThread(BackfillThreadPayload),
    // Creates a message object in the database. If the message is the last message in
    // the thread to be processed, it sends an UpdateThreadMetadata message for the thread.
    BackfillMessage(BackfillMessagePayload),
    // Updates the thread metadata in the database. If it's the last thread to be processed,
    // it sets the backfill job status to complete. Sends BackfillAttachment messages for each
    // attachment requiring backfill, except for the criteria of attachments in any threads
    // with a participant the user has previously emailed. This criteria we can only know after
    // backfill completes. Once backfill is completed it sends a BackfillAttachment message
    // for each of those attachments.
    UpdateThreadMetadata(UpdateMetadataPayload),
    // Uploads the message attachment as a Macro document.
    BackfillAttachment(BackfillAttachmentPayload),
}

// the object we send on the backfill pubsub queue
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillPubsubMessage {
    pub link_id: Uuid,
    // the id of the backfill job in the backfill_job table
    pub job_id: Uuid,
    // the operation being performed (init, backfill_thread, backfill_message)
    pub backfill_operation: BackfillOperation,
}

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
    ToSchema,
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
#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
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

impl From<db_backfill::BackfillJobStatus> for BackfillJobStatus {
    fn from(status: db_backfill::BackfillJobStatus) -> Self {
        match status {
            db_backfill::BackfillJobStatus::Init => BackfillJobStatus::Init,
            db_backfill::BackfillJobStatus::InProgress => BackfillJobStatus::InProgress,
            db_backfill::BackfillJobStatus::Complete => BackfillJobStatus::Complete,
            db_backfill::BackfillJobStatus::Cancelled => BackfillJobStatus::Cancelled,
            db_backfill::BackfillJobStatus::Failed => BackfillJobStatus::Failed,
        }
    }
}

impl From<db_backfill::BackfillJob> for BackfillJob {
    fn from(job: db_backfill::BackfillJob) -> Self {
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

#[derive(Debug, FromRow)]
pub struct BackfillJobCounters {
    pub total_threads: i32,
    pub threads_processed_count: i32,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct UpdateMetadataPayload {
    pub thread_provider_id: String,
    pub thread_db_id: Uuid,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct BackfillAttachmentPayload {
    pub attachment_db_id: Uuid,
    pub email_provider_id: String,
    pub provider_attachment_id: String,
    pub mime_type: String,
    pub filename: String,
    pub internal_date_ts: DateTime<Utc>,
}
