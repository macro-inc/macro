/// The list backfill and the legacy-graph audit.
pub mod backfill;
/// The rollout gate for list-aware directory messages.
pub mod list_writes;
/// Domain models for contact graphs and users.
pub mod models;
/// Port traits defining boundaries between domain and infrastructure.
pub mod ports;
/// Domain service implementing business logic.
pub mod service;
