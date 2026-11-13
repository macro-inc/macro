/// Event-to-activity mappings for this domain.
pub mod activity;
/// Observed RTC participation and meeting-attendance read capabilities.
pub mod attendance;
/// Kafka event contracts for call lifecycle events.
pub mod events;
/// Public call notifications for access-checked subscribers.
pub mod notification_events;

/// Domain models for calls.
pub mod models;

/// Unified entity-mutation capability impls.
#[cfg(feature = "ports")]
pub mod entity_mutation;

/// Port traits for calls.
#[cfg(feature = "ports")]
pub mod ports;

/// Service orchestration for calls.
#[cfg(feature = "ports")]
pub mod service;

/// Persistent meeting invitations and guest models.
pub mod meetings;

/// Provider-independent durable call entities and optional resources.
pub mod records;

/// Authorized ingestion and owner-scoped reads of imported calls.
#[cfg(feature = "ports")]
pub mod imports;
