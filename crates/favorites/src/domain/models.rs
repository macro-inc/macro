//! Domain models for favorites.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use serde::{Deserialize, Serialize};

/// A single favorited entity, including display metadata hydrated from the
/// favorited entity where available. Display names are deliberately not
/// included: clients resolve them from the entity previews pipeline, which
/// is viewer-relative for DM channels and updated by renames.
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

/// Authenticated actor performing a favorites mutation.
#[derive(Clone, Debug)]
pub struct FavoritesMutationActor {
    /// Stable Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// Organization id attached to the authenticated request, when present.
    pub organization_id: Option<i64>,
}

/// Errors returned by the favorites service.
#[derive(Debug, thiserror::Error)]
pub enum FavoritesError {
    /// The favorite (or entity) could not be found in the user's collection.
    #[error("favorite not found")]
    NotFound,
    /// The entity kind is not supported by the favorites mutation surface.
    #[error("entities of type {0} cannot be favorited")]
    UnsupportedEntityType(EntityType),
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The receipt does not belong to an authenticated user.
    #[error("you do not have access to this entity")]
    Unauthorized,
    /// Any other internal error.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
