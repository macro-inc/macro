use model::annotations::{Anchor, CommentThread};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResponse {
    pub data: Vec<CommentThread>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnchorResponse {
    pub data: Vec<Anchor>,
}
