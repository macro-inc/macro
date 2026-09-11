//! Outbound adapters for entity access.
//!
//! These modules contain concrete implementations of the domain ports.

mod pg_access_repo;
mod pg_explain_access_repo;

pub use pg_access_repo::{
    PgAccessRepository, SourceIds, get_team_scope_source_ids, get_user_source_ids,
};
pub use pg_explain_access_repo::PgExplainAccessRepository;
