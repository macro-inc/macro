//! Outbound adapters for entity access.
//!
//! These modules contain concrete implementations of the domain ports.

mod pg_access_repo;
#[cfg(feature = "explain_binary")]
mod pg_explain_access_repo;

pub use pg_access_repo::{
    PgAccessRepository, SharedEmailThread, accessible_session_ids, project_email_threads,
    project_shared_email_threads, shared_email_threads,
};
#[cfg(feature = "explain_binary")]
pub use pg_explain_access_repo::PgExplainAccessRepository;
