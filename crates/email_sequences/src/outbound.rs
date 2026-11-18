//! Outbound (driven) adapters for sequences.

mod owner_access;
mod pg_repo;

pub use owner_access::{CrmOwnerAccess, OwnerAccessError, SEQUENCES_FLAG};
pub use pg_repo::{PgSequenceError, PgSequenceRepo};
