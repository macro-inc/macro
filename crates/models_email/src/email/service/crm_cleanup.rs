//! Types for the nightly CRM cleanup queue. Message deletions upsert
//! `(link_id, contact_email)` rows into `crm_cleanup_candidates`; a nightly
//! EventBridge-triggered job pages through the table and tears down CRM rows
//! for contacts that no longer have any messages on the link.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use strum::{AsRefStr, Display, EnumString};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CrmCleanupOperation {
    // Nightly kickoff, sent by EventBridge directly to the queue as the
    // static payload {"operation":"start_job"}. Snapshots the candidate
    // table, creates the job row, and enqueues the first ListCandidates.
    StartJob,
    // Lists one keyset page of candidates (id > last_id, bounded by the job's
    // max_candidate_id snapshot), publishes a ProcessCandidate per row, then
    // re-enqueues itself with the new cursor. A short page completes the job.
    ListCandidates {
        job_id: Uuid,
        last_id: i64,
    },
    // Claims (deletes) the candidate row, then depopulates the CRM contact if
    // the link has no remaining messages involving the contact.
    ProcessCandidate {
        link_id: Uuid,
        contact_email: String,
    },
}

// the object we send on the crm cleanup pubsub queue
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrmCleanupPubsubMessage {
    pub operation: CrmCleanupOperation,
}

// Enum for crm cleanup job status
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
#[sqlx(type_name = "crm_cleanup_job_status", rename_all = "PascalCase")]
pub enum CrmCleanupJobStatus {
    Init,
    InProgress,
    // Fanout complete: every candidate in the snapshot has been dispatched.
    // ProcessCandidate messages may still be in flight or retrying.
    Complete,
    Failed,
}

// Struct for the crm_cleanup_jobs table
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CrmCleanupJob {
    pub id: Uuid,
    pub status: CrmCleanupJobStatus,
    // Candidate row count at kickoff, for observability
    pub total_candidates: i64,
    // Number of candidates dispatched as ProcessCandidate messages so far.
    // Observability only: redelivered lister pages re-count, so this can
    // exceed total_candidates.
    pub dispatched_count: i64,
    // MAX(crm_cleanup_candidates.id) at kickoff; the job only processes ids <= this
    pub max_candidate_id: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A row of `crm_cleanup_candidates`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CrmCleanupCandidate {
    pub id: i64,
    pub link_id: Uuid,
    pub contact_email: String,
}
