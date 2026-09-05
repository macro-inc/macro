//! Ports (trait contracts) for the favorites domain.

use std::collections::HashSet;

use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::domain::models::{Favorite, FavoritesError, FavoritesMutationActor};

/// Outbound persistence port for favorites.
pub trait FavoritesRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Send + std::fmt::Debug;

    /// Insert a favorite at the end of the user's collection.
    ///
    /// Adding an entity that is already favorited by the user is a no-op
    /// that returns the existing record.
    fn add_favorite(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<Favorite, Self::Err>> + Send;

    /// Count the favorites currently in the user's collection.
    fn count_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// List the user's favorites in manual order, hydrated with display
    /// metadata. Favorites pointing at deleted entities are omitted.
    fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Favorite>, Self::Err>> + Send;

    /// Remove the favorite for the given entity from the user's collection.
    ///
    /// Returns `true` when a row was removed.
    fn remove_favorite_by_entity(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Persist a manual ordering for the user's favorites. `ordered` is the
    /// full list of the user's favorited entities in the desired order;
    /// entities the user has not favorited are ignored.
    fn reorder_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        ordered: &[Entity<'_>],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Of the given entities, return the subset favorited by the user.
    fn favorited_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> impl Future<Output = Result<HashSet<Entity<'static>>, Self::Err>> + Send;
}

/// Authorization port used by favorites mutation use cases.
pub trait FavoritesAuthorizer: Send + Sync + 'static {
    /// Verify that the actor can view the entity being added to favorites.
    fn authorize_favorite(
        &self,
        actor: &FavoritesMutationActor,
        entity: &Entity<'static>,
    ) -> impl Future<Output = Result<EntityAccessReceipt<ViewAccessLevel>, FavoritesError>> + Send;
}

impl<A> FavoritesAuthorizer for A
where
    A: EntityAccessService,
{
    async fn authorize_favorite(
        &self,
        actor: &FavoritesMutationActor,
        entity: &Entity<'static>,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, FavoritesError> {
        self.generate_entity_access_receipt::<ViewAccessLevel>(
            &actor.user_id,
            actor.organization_id,
            &entity.entity_id,
            entity.entity_type,
        )
        .await
        .map_err(|error| match error {
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                FavoritesError::Unauthorized
            }
            AccessError::NotFound(_) => FavoritesError::NotFound,
            AccessError::BadRequest(message) => FavoritesError::BadRequest(message.to_string()),
            error @ (AccessError::Unavailable(_) | AccessError::Internal(_)) => {
                FavoritesError::Internal(anyhow::Error::new(error))
            }
        })
    }
}

/// Inbound service port for favorite and ordering mutations.
pub trait FavoritesMutationService: Send + Sync + 'static {
    /// Set whether an entity belongs to the actor's favorites collection.
    fn set_favorite(
        &self,
        actor: FavoritesMutationActor,
        entity: Entity<'static>,
        favorite: bool,
    ) -> impl Future<Output = Result<Entity<'static>, FavoritesError>> + Send;

    /// Persist a complete manual order and return the authoritative collection.
    fn reorder_favorites(
        &self,
        user_id: MacroUserIdStr<'static>,
        ordered: Vec<Entity<'static>>,
    ) -> impl Future<Output = Result<Vec<Favorite>, FavoritesError>> + Send;
}

/// Inbound service port: the favorites API used by drivers (HTTP, soup enrichment).
pub trait FavoritesService: Send + Sync + 'static {
    /// Add an entity to the user's favorites (idempotent).
    fn add_favorite(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Favorite, FavoritesError>> + Send;

    /// Add an entity after a trusted caller has already established that the
    /// user can view it.
    ///
    /// This supports internal workflows, such as favoriting an entity that the
    /// same workflow just created for the user, where no access receipt exists
    /// at the driving boundary.
    fn add_favorite_with_established_access(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<Favorite, FavoritesError>> + Send;

    /// List the user's favorites in manual order.
    fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Favorite>, FavoritesError>> + Send;

    /// Remove the favorite for the given entity from the user's collection.
    fn remove_favorite_by_entity(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<(), FavoritesError>> + Send;

    /// Persist a manual ordering for the user's favorites.
    fn reorder_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        ordered: &[Entity<'_>],
    ) -> impl Future<Output = Result<(), FavoritesError>> + Send;

    /// Of the given entities, return the subset favorited by the user.
    fn favorited_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> impl Future<Output = Result<HashSet<Entity<'static>>, FavoritesError>> + Send;
}
