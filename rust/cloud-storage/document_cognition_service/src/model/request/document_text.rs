use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct CreateTextRequestBody {
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct CreateTextRequestParams {
    pub document_id: String,
}
