//! Glue adapter exposing the favorites service to viewer-specific
//! `is_favorited` enrichment.

use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Arc;

use favorites::domain::ports::FavoritesService as _;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use search_service::SearchFavoritesReader;
use soup::inbound::axum_router::SoupFavoritesReader;

use crate::api::context::FavoritesServiceType;

/// Soup and search favorite readers backed by the DSS favorites service.
pub struct DssSoupFavoritesReader(pub Arc<FavoritesServiceType>);

impl DssSoupFavoritesReader {
    async fn resolve(
        &self,
        user_id: &str,
        entities: Vec<Entity<'static>>,
    ) -> anyhow::Result<HashSet<Entity<'static>>> {
        let user = MacroUserIdStr::parse_from_str(user_id)?;
        Ok(self.0.favorited_entities(&user, &entities).await?)
    }
}

impl SoupFavoritesReader for DssSoupFavoritesReader {
    fn favorited_entities<'a>(
        &'a self,
        user_id: &'a str,
        entities: Vec<Entity<'static>>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<HashSet<Entity<'static>>>> + Send + 'a>> {
        Box::pin(self.resolve(user_id, entities))
    }
}

impl SearchFavoritesReader for DssSoupFavoritesReader {
    fn favorited_entities<'a>(
        &'a self,
        user_id: &'a str,
        entities: Vec<Entity<'static>>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<HashSet<Entity<'static>>>> + Send + 'a>> {
        Box::pin(self.resolve(user_id, entities))
    }
}
