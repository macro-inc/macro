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

/// Imported document state and explicit save timestamps.
pub mod state;
/// Errors returned by imported document state.
pub mod state_error;

/// Runtime capability boundaries for a room.
pub mod ports;
/// Session identities and port data.
pub mod types;

/// Operation-log durability and replay policy.
pub mod operation_log;

/// Owned room memory and capabilities.
pub mod room;
