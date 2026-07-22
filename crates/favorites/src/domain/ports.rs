//! Ports (trait contracts) for the favorites domain.

use std::collections::HashSet;

use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::domain::models::{Favorite, FavoritesError};

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

/// Inbound service port: the favorites API used by drivers (HTTP, soup enrichment).
pub trait FavoritesService: Send + Sync + 'static {
    /// Add an entity to the user's favorites (idempotent).
    fn add_favorite(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
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
