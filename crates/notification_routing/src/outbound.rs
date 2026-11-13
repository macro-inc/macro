//! Outbound (driven) adapters for notification stacks.

#[cfg(feature = "postgres")]
pub mod pg_document_placements;
#[cfg(feature = "postgres")]
pub mod pg_stack_repo;
