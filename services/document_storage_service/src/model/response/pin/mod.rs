use utoipa::ToSchema;

use model::pin::PinnedItem;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct UserPinsResponse {
    /// The pins returned from the query
    pub recent: Vec<PinnedItem>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetPinsResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<UserPinsResponse>,
}
