use model::chat::Chat;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct GetChatsForAttachmentResponse {
    pub recent_chat: Option<Chat>,
    pub all_chats: Vec<Chat>,
}
