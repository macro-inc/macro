use model::annotations::Anchor;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnchorResponse {
    pub data: Vec<Anchor>,
}
