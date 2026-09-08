//! GraphQL inbound adapter for the favorites domain: ordered favorite objects,
//! user-scoped queries, mutations, and the DataLoader-backed current-viewer
//! favorite edge.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Lazy favorite-state edge loading.
mod loaders;
/// GraphQL favorite mutation adapter.
mod mutations;
/// GraphQL favorite output objects.
mod objects;
/// User-scoped favorites query adapter.
mod queries;

pub use loaders::{
    EntityFavoriteEdgeReader, EntityFavoriteLoader, NoOpEntityFavoriteEdgeReader,
    entity_favorite_loader, load_entity_favorite,
};
pub use mutations::{FavoriteMutationRoot, NoOpFavoriteMutationService, ReorderFavoritesInput};
pub use objects::GraphqlFavorite;
pub use queries::{FavoriteQueryReader, resolve_favorites};
