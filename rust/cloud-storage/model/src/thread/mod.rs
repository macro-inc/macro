pub mod request;
pub mod response;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmailThreadPermission {
    pub thread_id: String,
    pub share_permission_id: String,
    pub user_id: String,
    pub project_id: Option<String>,
}
