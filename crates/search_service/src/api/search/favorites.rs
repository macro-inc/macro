use std::collections::HashSet;

use model_entity::{Entity, EntityType};
use models_search::unified::UnifiedSearchResponseItem;

use crate::domain::favorites::SearchFavoritesReader;

fn favorite_entity(item: &UnifiedSearchResponseItem) -> Entity<'static> {
    let (entity_type, entity_id) = match item {
        UnifiedSearchResponseItem::AgentSession(item) => (EntityType::AgentSession, item.id),
        UnifiedSearchResponseItem::Document(item) => (EntityType::Document, item.extra.id),
        UnifiedSearchResponseItem::Chat(item) => (EntityType::Chat, item.extra.id),
        UnifiedSearchResponseItem::Email(item) => (EntityType::EmailThread, item.extra.id),
        UnifiedSearchResponseItem::ChannelMessage(item) => (EntityType::Channel, item.channel_id),
        UnifiedSearchResponseItem::Channel(item) => (EntityType::Channel, item.channel_id),
        UnifiedSearchResponseItem::Project(item) => (EntityType::Project, item.extra.id),
        UnifiedSearchResponseItem::Call(item) => (EntityType::Call, item.extra.id),
        UnifiedSearchResponseItem::Company(item) => (EntityType::CrmCompany, item.id),
        UnifiedSearchResponseItem::CalendarEvent(item) => {
            (EntityType::CalendarEvent, item.extra.id)
        }
    };
    entity_type.with_entity_string(entity_id.to_string())
}

fn set_is_favorited(item: &mut UnifiedSearchResponseItem, is_favorited: bool) {
    match item {
        UnifiedSearchResponseItem::AgentSession(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::Document(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::Chat(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::Email(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::ChannelMessage(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::Channel(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::Project(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::Call(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::Company(item) => item.is_favorited = is_favorited,
        UnifiedSearchResponseItem::CalendarEvent(item) => item.is_favorited = is_favorited,
    }
}

pub(super) async fn enrich_favorite_state(
    favorites: &dyn SearchFavoritesReader,
    user_id: &str,
    mut items: Vec<UnifiedSearchResponseItem>,
) -> Vec<UnifiedSearchResponseItem> {
    let entities: HashSet<Entity<'static>> = items.iter().map(favorite_entity).collect();
    if entities.is_empty() {
        return items;
    }

    let favorited = match favorites
        .favorited_entities(user_id, entities.into_iter().collect())
        .await
    {
        Ok(favorited) => favorited,
        Err(error) => {
            tracing::error!(error=?error, "failed to resolve favorited unified search results");
            return items;
        }
    };

    for item in &mut items {
        let is_favorited = favorited.contains(&favorite_entity(item));
        set_is_favorited(item, is_favorited);
    }

    items
}

#[cfg(test)]
mod test;
