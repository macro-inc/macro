use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatHistoryBatchMessagesRequest {
    pub message_ids: Vec<String>,
}
