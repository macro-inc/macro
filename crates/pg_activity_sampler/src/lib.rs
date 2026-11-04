//! Logs MacroDB sessions whose transaction stays open too long, with the
//! session's `application_name` and query, so the owning service can be found
//! from logs. One replica samples `pg_stat_activity` at a time.

pub mod domain;
pub mod outbound;
