//! Nightly CRM cleanup worker. An EventBridge cron sends a static `StartJob`
//! payload straight to the queue; the handler creates a `crm_cleanup_jobs`
//! row and enqueues the first `ListCandidates` message; the lister pages
//! through `crm_cleanup_candidates` with a keyset cursor, fanning out one
//! `ProcessCandidate` per pair and re-enqueueing itself until the job's
//! `max_candidate_id` snapshot is exhausted.

mod list_candidates;
mod process;
mod process_candidate;
mod start_job;
pub mod worker;
