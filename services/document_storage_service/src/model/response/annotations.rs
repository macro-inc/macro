use serde::Serialize;
use shared_types::annotations::Anchor;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnchorResponse {
    pub data: Vec<Anchor>,
}
