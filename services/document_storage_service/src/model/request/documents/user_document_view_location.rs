use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct UpsertUserDocumentViewLocationRequest {
    pub location: String,
}
