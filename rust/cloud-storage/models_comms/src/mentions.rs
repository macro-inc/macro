use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteMentionsRequest {
    pub item_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityMention {
    pub id: Uuid,
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub user_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateEntityMentionRequest {
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub entity_type: String,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateEntityMentionResponse {
    pub id: String,
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub user_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}
