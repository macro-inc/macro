//! Authorized favorites mutation use cases.

#[cfg(test)]
mod test;

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};

use crate::domain::{
    models::{Favorite, FavoritesError, FavoritesMutationActor},
    ports::{FavoritesAuthorizer, FavoritesMutationService, FavoritesService},
};

/// Favorites mutation service that composes authorization with the core
/// favorites service.
#[derive(Debug, Clone)]
pub struct FavoritesMutationServiceImpl<S, A> {
    /// Core favorites use cases and persistence boundary.
    favorites: Arc<S>,
    /// Entity-view authorization boundary.
    authorizer: Arc<A>,
}

impl<S, A> FavoritesMutationServiceImpl<S, A> {
    /// Compose favorites mutations from the core service and authorizer.
    pub fn new(favorites: Arc<S>, authorizer: Arc<A>) -> Self {
        Self {
            favorites,
            authorizer,
        }
    }
}

impl<S, A> FavoritesMutationService for FavoritesMutationServiceImpl<S, A>
where
    S: FavoritesService,
    A: FavoritesAuthorizer,
{
    #[tracing::instrument(err, skip(self))]
    async fn set_favorite(
        &self,
        actor: FavoritesMutationActor,
        entity: Entity<'static>,
        favorite: bool,
    ) -> Result<Entity<'static>, FavoritesError> {
        validate_favoritable(entity.entity_type)?;

        if favorite {
            let receipt = self.authorizer.authorize_favorite(&actor, &entity).await?;
            self.favorites.add_favorite(&receipt).await?;
        } else {
            self.favorites
                .remove_favorite_by_entity(&actor.user_id, &entity)
                .await?;
        }

        Ok(entity)
    }

    #[tracing::instrument(err, skip(self, ordered))]
    async fn reorder_favorites(
        &self,
        user_id: MacroUserIdStr<'static>,
        ordered: Vec<Entity<'static>>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        self.favorites.reorder_favorites(&user_id, &ordered).await?;
        self.favorites.list_favorites(&user_id).await
    }
}

/// Validate the entity kinds supported by the favorite toggle.
///
/// Favorites storage is intentionally broader for trusted internal workflows,
/// while the interactive toggle accepts only entity kinds with a supported
/// user-facing favorite lifecycle.
fn validate_favoritable(entity_type: EntityType) -> Result<(), FavoritesError> {
    match entity_type {
        EntityType::Document
        | EntityType::Project
        | EntityType::Chat
        | EntityType::Channel
        | EntityType::EmailThread
        | EntityType::Call
        | EntityType::ForeignEntity
        | EntityType::CrmCompany => Ok(()),
        EntityType::User
        | EntityType::Team
        | EntityType::ChannelMessage
        | EntityType::StaticFile
        | EntityType::CrmContact
        | EntityType::CalendarEvent
        | EntityType::Reminder
        | EntityType::Skill
        | EntityType::AgentSession => Err(FavoritesError::UnsupportedEntityType(entity_type)),
    }
}
