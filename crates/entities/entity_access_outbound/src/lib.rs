//! The PostgreSQL adapters behind `entity_access`'s ports.
//!
//! A crate of its own so that the ~120 crates depending on the access domain
//! do not rebuild when a query changes.

#![deny(missing_docs)]

mod pg_access_repo;
#[cfg(feature = "explain_binary")]
mod pg_explain_access_repo;

pub use pg_access_repo::{
    PgAccessRepository, SharedEmailThread, SourceIds, accessible_session_ids,
    get_team_scope_source_ids, get_user_source_ids, project_email_threads,
    project_shared_email_threads, shared_email_threads,
};
#[cfg(feature = "explain_binary")]
pub use pg_explain_access_repo::PgExplainAccessRepository;
