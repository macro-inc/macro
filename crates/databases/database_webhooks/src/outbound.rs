//! Driven adapters: Postgres for webhooks, the databases service for their
//! tables, and entity access for their creators' grants.

pub mod databases_tables;
pub mod entity_access_creators;
pub mod pg_webhooks_repo;
