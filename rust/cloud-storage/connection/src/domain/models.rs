//! Domain models for the connection crate.

use std::borrow::Cow;

use entity_access::domain::models::{EntityAccessAuth, EntityType};

/// The invalidation message type
pub const INVALIDATION_MESSAGE_TYPE: &str = "invalidation";

/// Errors that can occur during connection operations.
#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

/// Reason for an entity to be invalidated
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InvalidationReason {
    /// The entity was deleted
    Deleted,
    /// The entities metadata was modified
    Metadata,
    /// The entities content was modified
    Content,
}

/// An invalidation event
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub struct InvalidationEvent<'a, T: std::fmt::Debug + serde::Serialize> {
    /// The id of the entity to invalidate
    pub entity_id: Cow<'a, str>,
    /// The type of the entity to invalidate
    pub entity_type: EntityType,
    /// The reason for invalidation
    pub invalidation_reason: InvalidationReason,
    /// The creator of the invalidation
    pub invalidated_by: EntityAccessAuth,
    /// Any additional metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<T>,
}
