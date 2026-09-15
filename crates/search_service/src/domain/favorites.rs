//! Port for resolving viewer-specific favorite state during search enrichment.

use std::{collections::HashSet, future::Future, pin::Pin};

use model_entity::Entity;

/// Read-only favorite lookup used to enrich search results.
pub trait SearchFavoritesReader: Send + Sync + 'static {
    /// Of the given entities, return the subset favorited by the user.
    fn favorited_entities<'a>(
        &'a self,
        user_id: &'a str,
        entities: Vec<Entity<'static>>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<HashSet<Entity<'static>>>> + Send + 'a>>;
}
