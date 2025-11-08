use ai::types::{ModelMetadata, Provider};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct AIModel {
    pub name: String,
    pub provider: Provider,
    pub metadata: ModelMetadata,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct GetModelsResponse {
    pub models: Vec<AIModel>,
}
