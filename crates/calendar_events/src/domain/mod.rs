//! Calendar domain layer.

/// Who a calendar mutation acts as, and through whose account it writes.
pub mod acting;
/// Kafka event models for the calendar topic.
pub mod events;
/// Domain models.
pub mod models;
/// User-initiated calendar mutation policy.
pub mod mutations;
/// Domain ports.
pub mod ports;
/// Calendar reminder dispatch policy.
pub mod reminder_dispatch;
/// Calendar business policy.
pub mod service;
