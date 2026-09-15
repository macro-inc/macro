use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use chrono::Utc;
use model_entity::{Entity, EntityType};
use models_search::{
    SearchHighlight, agent_session::AgentSessionSearchResponseItem,
    channel::ChannelMessageSearchResponseItem, unified::UnifiedSearchResponseItem,
};
use uuid::Uuid;

use super::*;

struct TestFavoritesReader {
    requested: Arc<Mutex<Vec<Entity<'static>>>>,
    favorited: HashSet<Entity<'static>>,
}

impl SearchFavoritesReader for TestFavoritesReader {
    fn favorited_entities<'a>(
        &'a self,
        _user_id: &'a str,
        entities: Vec<Entity<'static>>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<HashSet<Entity<'static>>>> + Send + 'a>> {
        self.requested.lock().unwrap().extend(entities);
        Box::pin(async move { Ok(self.favorited.clone()) })
    }
}

#[tokio::test]
async fn resolves_parent_channels_and_unsupported_entity_types() {
    let channel_id = Uuid::new_v4();
    let agent_session_id = Uuid::new_v4();
    let requested = Arc::new(Mutex::new(Vec::new()));
    let reader = TestFavoritesReader {
        requested: requested.clone(),
        favorited: HashSet::from([
            EntityType::Channel.with_entity_string(channel_id.to_string()),
            EntityType::AgentSession.with_entity_string(agent_session_id.to_string()),
        ]),
    };
    let items = vec![
        UnifiedSearchResponseItem::ChannelMessage(ChannelMessageSearchResponseItem {
            id: channel_id,
            owner_id: None,
            channel_type: "public".to_string(),
            channel_id,
            is_favorited: false,
            message_id: Uuid::new_v4(),
            thread_id: None,
            sender_id: "sender".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
            highlight: SearchHighlight::default(),
            score: None,
        }),
        UnifiedSearchResponseItem::AgentSession(AgentSessionSearchResponseItem {
            id: agent_session_id,
            is_favorited: false,
            name: "Agent session".to_string(),
            owner_id: "owner".to_string(),
            bot_id: Uuid::new_v4(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            agent_session_search_results: Vec::new(),
        }),
    ];

    let items = enrich_favorite_state(&reader, "user", items).await;

    assert!(
        matches!(&items[0], UnifiedSearchResponseItem::ChannelMessage(item) if item.is_favorited)
    );
    assert!(
        matches!(&items[1], UnifiedSearchResponseItem::AgentSession(item) if item.is_favorited)
    );
    assert_eq!(
        requested
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect::<HashSet<_>>(),
        reader.favorited
    );
}
