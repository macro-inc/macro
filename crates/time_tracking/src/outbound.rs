//! Driven adapters: Postgres storage and report reads, a project's tasks, the
//! event broker, the person's open sessions and the rollout.

pub mod gateway_updates;
pub mod kafka_events;
pub mod pg_report_repo;
pub mod pg_time_repo;
pub mod project_tasks;
pub mod rollout;
