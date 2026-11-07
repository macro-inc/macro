//! Pure synchronization policy and persisted data, independent of transport.

/// Reserved peer identifiers used by agent editors.
pub mod ai_peer;
/// Connection metadata and surface lifecycle.
pub mod connection;
/// Document access, snapshots and atomic update policy.
pub mod document;
/// Persisted session migration state.
pub mod migration;
/// Serialized document request and response models.
pub mod models;
/// Verified grants and permission policy.
pub mod permissions;
/// Stable hibernatable socket identifiers.
pub mod socket;
