//! Favorites service implementation.

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::domain::models::{Favorite, FavoritesError};
use crate::domain::ports::{FavoritesRepo, FavoritesService};

/// Upper bound on favorites per user; keeps reorder payloads and sidebar
/// lists sane.
pub const MAX_FAVORITES_PER_COLLECTION: usize = 500;

/// Concrete favorites service backed by a [FavoritesRepo].
#[derive(Debug, Clone)]
pub struct FavoritesServiceImpl<R> {
    repo: R,
}

impl<R> FavoritesServiceImpl<R>
where
    R: FavoritesRepo,
    anyhow::Error: From<R::Err>,
{
    /// Create a favorites service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

fn validate_entity(entity: &Entity<'_>) -> Result<(), FavoritesError> {
    if entity.entity_id.trim().is_empty() {
        return Err(FavoritesError::BadRequest(
            "entity_id must not be empty".to_string(),
        ));
    }
    Ok(())
}

impl<R> FavoritesService for FavoritesServiceImpl<R>
where
    R: FavoritesRepo,
    anyhow::Error: From<R::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn add_favorite(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<Favorite, FavoritesError> {
        validate_entity(entity)?;
        // Cap the collection at add time. Enforcing it here (rather than only
        // in `reorder_favorites`) keeps table growth bounded and guarantees a
        // reorder payload can never exceed the limit and be rejected. Re-adding
        // an already-favorited entity while exactly at the cap is rejected too;
        // that is a harmless, fail-closed edge.
        let count = self
            .repo
            .count_favorites(user_id)
            .await
            .map_err(anyhow::Error::from)?;
        if count as usize >= MAX_FAVORITES_PER_COLLECTION {
            return Err(FavoritesError::BadRequest(format!(
                "cannot have more than {MAX_FAVORITES_PER_COLLECTION} favorites"
            )));
        }
        Ok(self
            .repo
            .add_favorite(user_id, entity)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        Ok(self
            .repo
            .list_favorites(user_id)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn remove_favorite_by_entity(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<(), FavoritesError> {
        validate_entity(entity)?;
        let removed = self
            .repo
            .remove_favorite_by_entity(user_id, entity)
            .await
            .map_err(anyhow::Error::from)?;
        if removed {
            Ok(())
        } else {
            Err(FavoritesError::NotFound)
        }
    }

    #[tracing::instrument(err, skip(self, ordered))]
    async fn reorder_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        ordered: &[Entity<'_>],
    ) -> Result<(), FavoritesError> {
        if ordered.is_empty() {
            return Ok(());
        }
        if ordered.len() > MAX_FAVORITES_PER_COLLECTION {
            return Err(FavoritesError::BadRequest(format!(
                "cannot reorder more than {MAX_FAVORITES_PER_COLLECTION} favorites"
            )));
        }
        let unique: HashSet<&Entity<'_>> = ordered.iter().collect();
        if unique.len() != ordered.len() {
            return Err(FavoritesError::BadRequest(
                "ordered entities must not contain duplicates".to_string(),
            ));
        }
        Ok(self
            .repo
            .reorder_favorites(user_id, ordered)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(err, skip(self, entities))]
    async fn favorited_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> Result<HashSet<Entity<'static>>, FavoritesError> {
        if entities.is_empty() {
            return Ok(HashSet::new());
        }
        Ok(self
            .repo
            .favorited_entities(user_id, entities)
            .await
            .map_err(anyhow::Error::from)?)
    }
}
