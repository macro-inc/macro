use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Settings {
    pub link_id: Uuid,
    pub signature_on_replies_forwards: bool,
    pub signature: Option<String>,
}
