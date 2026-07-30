use std::{collections::HashMap, sync::Arc};

use async_graphql::{Context, dataloader::DataLoader};
use favorites::domain::ports::FavoritesService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, OwnedEntity};
use rootcause::markers::{Cloneable, Dynamic};

#[cfg(test)]
mod test;

/// Favorites reader used by GraphQL entity edges.
pub trait EntityFavoriteEdgeReader: Send + Sync + 'static {
    /// Resolve favorite state for the requested entities.
    fn get_entity_favorites<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Result<HashMap<Entity<'static>, bool>, rootcause::Report>> + Send + 'a;
}

impl<T> EntityFavoriteEdgeReader for Arc<T>
where
    T: FavoritesService,
{
    async fn get_entity_favorites(
        &self,
        user_id: &MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, bool>, rootcause::Report> {
        let favorites = self
            .favorited_entities(user_id, &entities)
            .await
            .map_err(|error| rootcause::report!(error))?;

        Ok(entities
            .into_iter()
            .map(|entity| {
                let is_favorited = favorites.contains(&entity);
                (entity, is_favorited)
            })
            .collect())
    }
}

/// Favorites reader used by schema-only GraphQL construction.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpEntityFavoriteEdgeReader;

impl EntityFavoriteEdgeReader for NoOpEntityFavoriteEdgeReader {
    async fn get_entity_favorites(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, bool>, rootcause::Report> {
        Ok(entities.into_iter().map(|entity| (entity, false)).collect())
    }
}

/// Request-scoped DataLoader for current-viewer favorite state.
pub struct EntityFavoriteLoader<R> {
    /// Authenticated viewer whose favorite state is requested.
    user_id: MacroUserIdStr<'static>,
    /// Domain-facing reader that resolves favorite state.
    reader: R,
}

impl<R> EntityFavoriteLoader<R> {
    /// Construct a favorite loader for one authenticated viewer.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: R) -> Self {
        Self { user_id, reader }
    }
}

impl<R> async_graphql::dataloader::Loader<OwnedEntity> for EntityFavoriteLoader<R>
where
    R: EntityFavoriteEdgeReader,
{
    type Value = bool;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(
        &self,
        keys: &[OwnedEntity],
    ) -> Result<HashMap<OwnedEntity, Self::Value>, Self::Error> {
        let entities = keys.iter().map(|key| key.as_entity().clone()).collect();
        match self
            .reader
            .get_entity_favorites(&self.user_id, entities)
            .await
        {
            Ok(favorites) => Ok(favorites
                .into_iter()
                .map(|(entity, is_favorited)| (OwnedEntity::from(entity), is_favorited))
                .collect()),
            Err(error) => {
                // Favorite state is an optional presentation edge. Preserve the
                // REST Soup contract: a favorites outage must not make the
                // underlying entities unavailable.
                tracing::error!(error = ?error, "failed to resolve GraphQL entity favorites");
                Ok(keys.iter().cloned().map(|key| (key, false)).collect())
            }
        }
    }
}

/// Build a favorite DataLoader scoped to the authenticated viewer.
pub fn entity_favorite_loader<R>(
    user_id: MacroUserIdStr<'static>,
    reader: R,
) -> DataLoader<EntityFavoriteLoader<R>>
where
    R: EntityFavoriteEdgeReader,
{
    DataLoader::new(EntityFavoriteLoader::new(user_id, reader), tokio::spawn)
}

/// Resolve favorite state from GraphQL request data.
pub async fn load_entity_favorite<R>(
    ctx: &Context<'_>,
    entity: Entity<'static>,
) -> async_graphql::Result<bool>
where
    R: EntityFavoriteEdgeReader,
{
    let loader = ctx.data::<DataLoader<EntityFavoriteLoader<R>>>()?;
    Ok(loader
        .load_one(OwnedEntity::from(entity))
        .await?
        .unwrap_or(false))
}
