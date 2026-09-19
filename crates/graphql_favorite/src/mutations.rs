use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, InputObject, Object};
use entity_mutation::EntityMutationErrorCode;
use favorites::domain::{
    models::{Favorite, FavoritesError, FavoritesMutationActor, SetFavoriteResult},
    ports::FavoritesMutationService,
};
use graphql_common::require_authenticated_user;
use graphql_entity_mutation::{EntityRefInput, GraphqlEntityMutationResult};
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::objects::GraphqlFavorite;

#[cfg(test)]
mod test;

/// Root GraphQL adapter for favorites mutations.
pub struct FavoriteMutationRoot<S, E>(PhantomData<fn() -> (S, E)>);

impl<S, E> FavoriteMutationRoot<S, E> {
    /// Construct a favorites mutation root.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

impl<S, E> Default for FavoriteMutationRoot<S, E> {
    fn default() -> Self {
        Self::new()
    }
}

/// Schema-only favorites mutation service.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpFavoriteMutationService;

impl FavoritesMutationService for NoOpFavoriteMutationService {
    async fn set_favorite(
        &self,
        _actor: FavoritesMutationActor,
        _entity: Entity<'static>,
        _favorite: bool,
    ) -> Result<SetFavoriteResult, FavoritesError> {
        Err(FavoritesError::BadRequest(
            "favorite mutations are not configured".to_string(),
        ))
    }

    async fn reorder_favorites(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _ordered: Vec<Entity<'static>>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        Err(FavoritesError::BadRequest(
            "favorite mutations are not configured".to_string(),
        ))
    }
}

/// Result of setting an entity's favorite state.
pub struct SetFavoritePayload<E: SoupEntityEdges> {
    /// Generic entity-mutation outcome, including normalized Soup effects.
    result: GraphqlEntityMutationResult<E>,
    /// Persisted favorite after an add, or `None` after a removal.
    favorite: Option<GraphqlFavorite>,
}

/// GraphQL result of setting an entity's favorite state.
#[Object]
impl<E: SoupEntityEdges> SetFavoritePayload<E> {
    /// Entity mutation result, including normalized Soup cache effects.
    async fn result(&self) -> &GraphqlEntityMutationResult<E> {
        &self.result
    }

    /// Persisted favorite after an add, or `null` after a removal.
    async fn favorite(&self) -> Option<&GraphqlFavorite> {
        self.favorite.as_ref()
    }
}

/// Input for persisting the authenticated user's complete favorites order.
#[derive(InputObject)]
pub struct ReorderFavoritesInput {
    /// Favorited entities in the desired order.
    pub favorites: Vec<EntityRefInput>,
}

/// Map a favorites failure into the existing entity-mutation result vocabulary.
fn mutation_error_code(error: FavoritesError) -> EntityMutationErrorCode {
    match error {
        error @ FavoritesError::UnsupportedEntityType(_) => {
            EntityMutationErrorCode::unsupported(rootcause::report!(error))
        }
        error @ FavoritesError::NotFound => {
            EntityMutationErrorCode::not_found(rootcause::report!(error))
        }
        error @ FavoritesError::BadRequest(_) => {
            EntityMutationErrorCode::invalid(rootcause::report!(error))
        }
        error @ FavoritesError::Unauthorized => {
            EntityMutationErrorCode::forbidden(rootcause::report!(error))
        }
        error @ FavoritesError::Internal(_) => {
            EntityMutationErrorCode::internal(rootcause::report!(error))
        }
    }
}

/// Expose failures to the transport so durable mutations roll back, including replay.
fn mutation_error(error: FavoritesError) -> async_graphql::Error {
    let message = match &error {
        FavoritesError::NotFound => "favorite not found".to_string(),
        FavoritesError::UnsupportedEntityType(_) | FavoritesError::BadRequest(_) => {
            error.to_string()
        }
        FavoritesError::Unauthorized => "not authorized to update favorites".to_string(),
        FavoritesError::Internal(_) => {
            tracing::error!(error = ?error, "failed to update favorites");
            "favorites mutation failed".to_string()
        }
    };
    async_graphql::Error::new(message)
}

/// GraphQL favorites mutations.
#[Object]
impl<S, E> FavoriteMutationRoot<S, E>
where
    S: FavoritesMutationService,
    E: SoupEntityEdges,
{
    /// Add or remove an entity and return the generic entity mutation result.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn set_entity_favorite(
        &self,
        ctx: &Context<'_>,
        entity: EntityRefInput,
        favorite: bool,
    ) -> async_graphql::Result<GraphqlEntityMutationResult<E>> {
        let actor = ctx.data::<FavoritesMutationActor>()?.clone();
        let service = ctx.data::<Arc<S>>()?;
        let result = service
            .set_favorite(actor, entity.into_model(), favorite)
            .await;

        // Preserve both the success and error union shapes for legacy callers.
        Ok(match result {
            Ok(result) => GraphqlEntityMutationResult::from_updated_entity(result.entity),
            Err(error) => GraphqlEntityMutationResult::from_error_code(mutation_error_code(error)),
        })
    }

    /// Add or remove an entity and return the persisted favorite record.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn set_favorite(
        &self,
        ctx: &Context<'_>,
        entity: EntityRefInput,
        favorite: bool,
    ) -> async_graphql::Result<SetFavoritePayload<E>> {
        let actor = ctx.data::<FavoritesMutationActor>()?.clone();
        let service = ctx.data::<Arc<S>>()?;
        let result = service
            .set_favorite(actor, entity.into_model(), favorite)
            .await
            .map_err(mutation_error)?;

        Ok(SetFavoritePayload {
            result: GraphqlEntityMutationResult::from_updated_entity(result.entity),
            favorite: result.favorite.map(GraphqlFavorite::new),
        })
    }

    /// Persist the authenticated user's complete favorites order and return the authoritative list.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn reorder_favorites(
        &self,
        ctx: &Context<'_>,
        input: ReorderFavoritesInput,
    ) -> async_graphql::Result<Vec<GraphqlFavorite>> {
        let user_id = require_authenticated_user(ctx)?;
        let ordered = input
            .favorites
            .into_iter()
            .map(EntityRefInput::into_model)
            .collect();
        let service = ctx.data::<Arc<S>>()?;
        let favorites = service
            .reorder_favorites(user_id, ordered)
            .await
            .map_err(mutation_error)?;

        Ok(favorites.into_iter().map(GraphqlFavorite::new).collect())
    }
}
