//! GraphQL inbound adapter for the favorites domain: the DataLoader-backed
//! current-viewer favorite edge attached to Soup entities.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Lazy favorite-state edge loading.
mod favorite;

pub use favorite::{
    EntityFavoriteEdgeReader, EntityFavoriteKey, EntityFavoriteLoader,
    NoOpEntityFavoriteEdgeReader, entity_favorite_loader, load_entity_favorite,
};
