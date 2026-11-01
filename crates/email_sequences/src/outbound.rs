//! Outbound (driven) adapters for sequences.

mod owner_access;
mod pg_repo;

pub use owner_access::{CrmOwnerAccess, OwnerAccessError};
pub use pg_repo::{PgSequenceError, PgSequenceRepo};
