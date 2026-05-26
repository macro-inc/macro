use crate::email::db::backfill as db_backfill;
use crate::email::service::thread::ListThreadsPayload;
use crate::service::attachment::AttachmentUploadArgs;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
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

/// Scope envelope for backfill operations that belong to a tracked backfill
/// job (Init, ListThreads, BackfillThread, BackfillMessage,
/// UpdateThreadMetadata, BackfillAttachment). Carries the `link_id` and
/// `job_id` the operation needs alongside its variant-specific payload.
/// The inner payload is `#[serde(flatten)]`-ed so the JSON shape stays the
/// same as if `link_id`/`job_id` and the payload fields were siblings.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct JobScopedPayload<P> {
    pub link_id: Uuid,
    pub job_id: Uuid,
    #[serde(flatten)]
    pub payload: P,
}

/// Scope envelope for backfill operations that are scoped to a single
/// `email_link` but not to a backfill job (e.g. `PopulateCrmContact`).
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct LinkScopedPayload<P> {
    pub link_id: Uuid,
    #[serde(flatten)]
    pub payload: P,
}

/// Empty payload for [`BackfillOperation::Init`]. The variant only needs the
/// shared `link_id`/`job_id` from `JobScopedPayload`; this struct exists so
/// every job-scoped variant has the same `JobScopedPayload<…>` shape.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq, Default)]
pub struct InitPayload {}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackfillOperation {
    // Populates total_threads and sends the first ListThreads message
    Init(JobScopedPayload<InitPayload>),
    // Each ListThreads operation gets a batch of 500 thread_ids from the gmail api
    // and sends a BackfillThread message for each thread_id in the batch. If there
    // are still threads left to fetch, it will send another ListThreads message.
    ListThreads(JobScopedPayload<ListThreadsPayload>),
    // Creates the thread object in the database, fetches the message ids for the thread
    // from the gmail api, and sends a BackfillMessage message for each message_id.
    BackfillThread(JobScopedPayload<BackfillThreadPayload>),
    // Creates a message object in the database. If the message is the last message in
    // the thread to be processed, it sends an UpdateThreadMetadata message for the thread.
    BackfillMessage(JobScopedPayload<BackfillMessagePayload>),
    // Updates the thread metadata in the database. If it's the last thread to be processed,
    // it sets the backfill job status to complete. Sends BackfillAttachment messages for each
    // attachment requiring backfill, except for the criteria of attachments in any threads
    // with a participant the user has previously emailed. This criteria we can only know after
    // backfill completes. Once backfill is completed it sends a BackfillAttachment message
    // for each of those attachments.
    UpdateThreadMetadata(JobScopedPayload<UpdateMetadataPayload>),
    // Uploads the message attachment as a Macro document.
    BackfillAttachment(JobScopedPayload<BackfillAttachmentPayload>),
    // Idempotently records a contact the requesting user has emailed into the
    // CRM tables (crm_companies, crm_domains, crm_contacts, crm_contact_sources).
    // Fanned out one-per-recipient from BackfillMessage when the message was
    // sent by the user. No-op if the user has no team or the contact's domain
    // has been opted out by the team (crm_companies.email_sync = false).
    PopulateCrmContact(LinkScopedPayload<PopulateCrmContactPayload>),
    // Walks the CRM cascade in reverse for one (link, contact_email): drops
    // the matching crm_contact_sources row, then crm_contacts when no other
    // sources remain, then crm_companies when no other contacts remain.
    // Fanned out one-per-recipient from delete_message when a sent message
    // is deleted. Ignores the company-level email_sync killswitch so that
    // deletions stay reflected in the CRM tables even on opted-out domains.
    DepopulateCrmContact(LinkScopedPayload<DepopulateCrmContactPayload>),
    // Fans out PopulateCrmContact messages for every contact a user has
    // previously emailed. Resolves the user's link + team itself (bails if
    // either is missing). Triggered when a user gets added to a team so
    // their historical sent-mail recipients seed the team's CRM tables.
    PopulateCrmForUser(PopulateCrmForUserPayload),
    // Tears down every CRM source row owned by the user's email link,
    // plus the contact/company rows that become orphaned as a result
    // (preserving companies with `email_sync = false`). Triggered when a
    // user is removed from a team. Team deletion is handled separately
    // via the `crm_companies.team_id` FK cascade in macrodb.
    DepopulateCrmForUser(DepopulateCrmForUserPayload),
}

impl BackfillOperation {
    /// Returns the link_id this operation is scoped to, or `None` for
    /// user-scoped operations that resolve the link themselves.
    pub fn link_id(&self) -> Option<Uuid> {
        match self {
            BackfillOperation::Init(s) => Some(s.link_id),
            BackfillOperation::ListThreads(s) => Some(s.link_id),
            BackfillOperation::BackfillThread(s) => Some(s.link_id),
            BackfillOperation::BackfillMessage(s) => Some(s.link_id),
            BackfillOperation::UpdateThreadMetadata(s) => Some(s.link_id),
            BackfillOperation::BackfillAttachment(s) => Some(s.link_id),
            BackfillOperation::PopulateCrmContact(s) => Some(s.link_id),
            BackfillOperation::DepopulateCrmContact(s) => Some(s.link_id),
            BackfillOperation::PopulateCrmForUser(_) => None,
            BackfillOperation::DepopulateCrmForUser(_) => None,
        }
    }

    /// Returns the backfill job_id this operation belongs to, or `None`
    /// for operations that don't participate in a tracked backfill job.
    pub fn job_id(&self) -> Option<Uuid> {
        match self {
            BackfillOperation::Init(s) => Some(s.job_id),
            BackfillOperation::ListThreads(s) => Some(s.job_id),
            BackfillOperation::BackfillThread(s) => Some(s.job_id),
            BackfillOperation::BackfillMessage(s) => Some(s.job_id),
            BackfillOperation::UpdateThreadMetadata(s) => Some(s.job_id),
            BackfillOperation::BackfillAttachment(s) => Some(s.job_id),
            BackfillOperation::PopulateCrmContact(_)
            | BackfillOperation::DepopulateCrmContact(_)
            | BackfillOperation::PopulateCrmForUser(_)
            | BackfillOperation::DepopulateCrmForUser(_) => None,
        }
    }
}

// the object we send on the backfill pubsub queue
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillPubsubMessage {
    // the operation being performed (init, backfill_thread, backfill_message,
    // populate_crm_contact, populate_crm_for_user). Each variant carries its
    // own link_id/job_id/macro_id as needed — see JobScopedPayload,
    // LinkScopedPayload, and PopulateCrmForUserPayload.
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
    pub metadata: AttachmentUploadArgs,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct PopulateCrmContactPayload {
    pub contact_email: String,
    /// Display name observed for `contact_email` at producer time — the
    /// caller copies it from the gmail message's recipient header
    /// (`backfill_message`, `upsert_message`) or from `email_contacts.name`
    /// (`populate_crm_for_user`). Threading it through the payload lets
    /// the consumer skip its own `email_contacts` round-trip. `None` when
    /// no display name was associated with the address.
    #[serde(default)]
    pub contact_name: Option<String>,
    /// Earliest interaction timestamp the producer knows about for this
    /// contact. Per-message paths set this to `message.internal_date_ts`
    /// (or `Utc::now()` when the message has none). The historical seed
    /// (`populate_crm_for_user`) sets it to MIN(internal_date_ts)
    /// across the contact's matching messages. Written to
    /// `first_interaction` on INSERT and LEAST-merged into the stored
    /// value on UPDATE (only when `is_sent=true` — received-direction
    /// populates don't pull the anchor backwards).
    pub first_at: DateTime<Utc>,
    /// Latest interaction timestamp the producer knows about for this
    /// contact. Per-message paths set this to `message.internal_date_ts`
    /// (or `Utc::now()` when the message has none). The historical seed
    /// sets it to MAX(internal_date_ts) across the contact's matching
    /// messages. Written to `last_interaction` on INSERT and
    /// GREATEST-merged into the stored value on UPDATE regardless of
    /// direction.
    pub last_at: DateTime<Utc>,
    /// `true` when the populating message was sent BY the user; `false`
    /// when it was received. Controls the consumer's insert semantics:
    /// `true` may INSERT a new `crm_companies` row for an unknown
    /// domain; `false` no-ops when the company isn't already tracked
    /// (received-direction populates only update existing rows). When
    /// the company IS tracked, both directions insert-or-update the
    /// `crm_contacts` row and add a `crm_contact_sources` row. See
    /// [`crm::domain::service::CrmService::populate_contact`] for the
    /// full matrix.
    #[serde(default)]
    pub is_sent: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct DepopulateCrmContactPayload {
    pub contact_email: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct PopulateCrmForUserPayload {
    pub macro_id: MacroUserIdStr<'static>,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct DepopulateCrmForUserPayload {
    pub macro_id: MacroUserIdStr<'static>,
    /// Team the user was just removed from. Passed explicitly because
    /// the consumer cannot recover this via `get_team_id_for_user` —
    /// by the time it runs the user has already been removed from
    /// `team_user`, so the lookup would either be empty or return a
    /// different team if the user is on multiple.
    pub team_id: Uuid,
}
