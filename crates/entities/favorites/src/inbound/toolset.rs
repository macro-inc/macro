//! AI toolset for adding items to and removing them from the user's favorites.

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use model_entity::EntityType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{FavoritesError, FavoritesMutationActor},
    ports::FavoritesMutationService,
};

/// Service context for favorites AI tools.
pub struct FavoritesToolContext<M: FavoritesMutationService> {
    /// Authorized favorite mutations.
    pub service: Arc<M>,
}

impl<M: FavoritesMutationService> Clone for FavoritesToolContext<M> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<M: FavoritesMutationService> FavoritesToolContext<M> {
    /// Create a favorites tool context.
    pub fn new(service: Arc<M>) -> Self {
        Self { service }
    }
}

/// Create the favorites toolset.
pub fn favorites_toolset<M: FavoritesMutationService>()
-> AsyncToolCollection<FavoritesToolContext<M>> {
    AsyncToolCollection::new().add_tool::<SetFavorite, FavoritesToolContext<M>>()
}

/// The kinds of item a user can favorite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FavoritableEntityType {
    /// A document (includes tasks).
    Document,
    /// A project (folder).
    Project,
    /// A channel.
    Channel,
    /// An email thread.
    Email,
    /// A call record.
    Call,
    /// A CRM company.
    CrmCompany,
    /// A CRM contact.
    CrmContact,
}

impl FavoritableEntityType {
    fn entity_type(self) -> EntityType {
        match self {
            Self::Document => EntityType::Document,
            Self::Project => EntityType::Project,
            Self::Channel => EntityType::Channel,
            Self::Email => EntityType::EmailThread,
            Self::Call => EntityType::Call,
            Self::CrmCompany => EntityType::CrmCompany,
            Self::CrmContact => EntityType::CrmContact,
        }
    }
}

/// Favorite or unfavorite an item.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "SetFavorite",
    description = "Add an item to the user's favorites (shown starred in the app sidebar) or remove it, as the Favorite action does. Requires view access to add an item. List favorites with ListEntities and favoritesOnly."
)]
pub struct SetFavorite {
    /// The kind of item.
    #[schemars(description = "The kind of item to favorite or unfavorite.")]
    pub entity_type: FavoritableEntityType,
    /// The item's id.
    #[schemars(description = "The id of the item.")]
    pub entity_id: Uuid,
    /// Whether the item should be a favorite.
    #[schemars(description = "True to add the item to favorites, false to remove it.")]
    pub favorite: bool,
}

/// The item's favorite state after the change.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetFavoriteResponse {
    /// The kind of item.
    pub entity_type: FavoritableEntityType,
    /// The item's id.
    pub entity_id: Uuid,
    /// Whether the item is now a favorite.
    pub favorite: bool,
}

impl ToolAnnotated for SetFavorite {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Set favorite").with_idempotent();
}

fn favorite_error(error: FavoritesError) -> ToolCallError {
    let description = match &error {
        FavoritesError::NotFound => "item not found".to_string(),
        FavoritesError::Unauthorized => {
            "you need view access to an item to favorite it".to_string()
        }
        FavoritesError::UnsupportedEntityType(entity_type) => {
            format!("items of type {entity_type} cannot be favorited")
        }
        FavoritesError::BadRequest(message) => message.clone(),
        FavoritesError::Internal(_) => "failed to update favorites".to_string(),
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

#[async_trait]
impl<M: FavoritesMutationService> AsyncTool<FavoritesToolContext<M>> for SetFavorite {
    type Output = SetFavoriteResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, entity_type=?self.entity_type, entity_id=%self.entity_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<FavoritesToolContext<M>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let entity = self
            .entity_type
            .entity_type()
            .with_entity_string(self.entity_id.to_string());
        let result = service_context
            .service
            .set_favorite(
                FavoritesMutationActor {
                    user_id: request_context.user_id,
                    organization_id: None,
                },
                entity,
                self.favorite,
            )
            .await
            .map_err(favorite_error)?;

        Ok(SetFavoriteResponse {
            entity_type: self.entity_type,
            entity_id: self.entity_id,
            favorite: result.favorite.is_some(),
        })
    }
}
