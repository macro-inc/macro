//! Driven adapters: Postgres for syncs, the databases service for their
//! tables, the call import for Granola meetings, and team rosters.

pub mod databases_tables;
pub mod granola_meetings;
pub mod pg_syncs_repo;
pub mod team_directory;
