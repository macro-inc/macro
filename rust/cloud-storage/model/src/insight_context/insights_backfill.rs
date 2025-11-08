use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use strum::{AsRefStr, Display, EnumString};
use utoipa::ToSchema;

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Display,
    AsRefStr,
    EnumString,
    ToSchema,
    sqlx::Type,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "PascalCase")]
#[sqlx(type_name = "insights_backfill_job_status", rename_all = "PascalCase")]
pub enum InsightsBackfillJobStatus {
    Init,
    InProgress,
    Complete,
    Cancelled,
    Failed,
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Display,
    AsRefStr,
    EnumString,
    ToSchema,
    sqlx::Type,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "PascalCase")]
#[sqlx(
    type_name = "insights_backfill_batch_status",
    rename_all = "PascalCase"
)]
pub enum InsightsBackfillBatchStatus {
    Queued,
    InProgress,
    Complete,
    Failed,
}

/// Main insights backfill job record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct EmailInsightsBackfillJob {
    pub id: String,
    pub user_id: String,

    // Progress counters
    pub threads_processed_count: i32,
    pub insights_generated_count: i32,

    // Status tracking
    pub status: Option<InsightsBackfillJobStatus>,

    // Metadata
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Individual batch tracking record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct EmailInsightsBackfillBatch {
    pub id: String,
    pub insights_backfill_job_id: String,

    // SQS tracking
    pub sqs_message_id: Option<String>,

    // Thread tracking
    pub thread_ids: Option<Vec<String>>,
    pub total_threads: i32,

    // Processing status
    pub status: InsightsBackfillBatchStatus,
    pub insights_generated_count: i32,
    pub insight_ids: Option<Vec<String>>,

    // Error handling
    pub error_message: Option<String>,

    // Timing
    pub queued_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Parameters for creating a new insights backfill job
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NewInsightsBackfillJob {
    pub user_id: String,
    pub user_thread_limit: Option<i32>,
    pub status: InsightsBackfillJobStatus,
    pub total_threads: i32,
    pub processed_threads: i32,
    pub total_batches: i32,
    pub processed_batches: i32,
    pub error_message: Option<String>,
}

/// Request to create a new insights backfill job
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateInsightsBackfillJobRequest {
    pub user_ids: Option<Vec<String>>,
    pub user_thread_limit: Option<i32>,
}

/// Response when creating a new insights backfill job
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateInsightsBackfillJobResponse {
    pub job_id: String,
    pub status: InsightsBackfillJobStatus,
    pub total_users: i32,
    pub created_at: DateTime<Utc>,
}

/// Progress summary for an insights backfill job
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct InsightsBackfillJobProgress {
    pub job_id: String,
    pub user_id: String,
    pub status: InsightsBackfillJobStatus,

    // Progress percentages
    pub batches_completion_percentage: f32,
    pub threads_completion_percentage: f32,

    // Counts
    pub total_threads: i32,
    pub batches_created: i32,
    pub batches_completed: i32,
    pub threads_processed: i32,
    pub insights_generated: i32,

    // Timing
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub estimated_completion_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl EmailInsightsBackfillJob {
    /// Check if the job is complete
    pub fn is_complete(&self) -> bool {
        self.status == Some(InsightsBackfillJobStatus::Complete)
    }

    /// Check if the job is in a terminal state
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            Some(
                InsightsBackfillJobStatus::Complete
                    | InsightsBackfillJobStatus::Failed
                    | InsightsBackfillJobStatus::Cancelled
            )
        )
    }

    /// Convert to progress summary
    pub fn to_progress(&self) -> InsightsBackfillJobProgress {
        InsightsBackfillJobProgress {
            job_id: self.id.clone(),
            user_id: self.user_id.clone(),
            status: self.status.unwrap_or(InsightsBackfillJobStatus::Init),
            batches_completion_percentage: 0.0,
            threads_completion_percentage: 0.0,
            total_threads: 0,
            batches_created: 0,
            batches_completed: 0,
            threads_processed: self.threads_processed_count,
            insights_generated: self.insights_generated_count,
            started_at: None,
            completed_at: self.completed_at,
            estimated_completion_at: self.estimate_completion_time(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }

    /// Estimate completion time based on current progress
    fn estimate_completion_time(&self) -> Option<DateTime<Utc>> {
        if self.is_terminal() {
            return self.completed_at;
        }
        None
    }
}

/// Parameters for creating a new insights backfill batch
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NewInsightsBackfillBatch {
    pub job_id: String,
    pub thread_count: i32,
    pub sqs_message_id: Option<String>,
    pub status: InsightsBackfillBatchStatus,
}

/// Thread processing result
#[derive(Debug, Clone)]
pub struct ThreadProcessingResult {
    pub thread_id: String,
    pub insights_generated_count: i32,
    pub processing_time_ms: Option<i32>,
    pub error_message: Option<String>,
}
