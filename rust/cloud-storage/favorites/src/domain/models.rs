//! Domain models for favorites.

use chrono::{DateTime, Utc};
use model_entity::{Entity, EntityType};
use serde::{Deserialize, Serialize};

/// A single favorited entity, including display metadata hydrated from the
/// favorited entity where available.
///
/// A favorite is identified by `(entity_type, entity_id)` within the user's
/// collection; there is no surrogate id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    /// The type of the favorited entity.
    // Inlined so the shared `EntityType` component name is not claimed in
    // specs that also expose the properties `EntityType` enum.
    #[cfg_attr(feature = "inbound", schema(inline))]
    pub entity_type: EntityType,
    /// The id of the favorited entity.
    pub entity_id: String,
    /// Manual ordering value; lower sorts first.
    pub sort_order: f64,
    /// When the favorite was created.
    pub created_at: DateTime<Utc>,
    /// Display name of the favorited entity, when it could be resolved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// File type of the favorited document, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// Document sub type (e.g. `task`) of the favorited document, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_sub_type: Option<String>,
    /// Channel type (e.g. `public`, `direct_message`) of the favorited channel, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_type: Option<String>,
    /// Owning channel id of the favorited channel message, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
}

impl Favorite {
    /// The favorited entity as a [model_entity::Entity].
    pub fn entity(&self) -> Entity<'_> {
        self.entity_type.with_entity_str(&self.entity_id)
    }
}

/// The user's favorites, in manual order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct FavoritesList {
    /// The requesting user's favorites, in manual order.
    pub favorites: Vec<Favorite>,
}

/// Errors returned by the favorites service.
#[derive(Debug, thiserror::Error)]
pub enum FavoritesError {
    /// The favorite (or entity) could not be found in the user's collection.
    #[error("favorite not found")]
    NotFound,
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// Any other internal error.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
