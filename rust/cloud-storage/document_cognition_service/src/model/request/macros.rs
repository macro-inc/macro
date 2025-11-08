use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMacroRequest {
    pub title: String,
    pub prompt: String,
    pub icon: String,
    pub color: String,
    pub required_docs: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchMacroRequest {
    pub title: Option<String>,
    pub prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub required_docs: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct GetMacroPathParams {
    pub macro_prompt_id: String,
}
