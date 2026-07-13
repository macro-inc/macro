#![allow(deprecated)]
use utoipa::ToSchema;

use model::activity::Activity;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[deprecated]
pub struct UserActivitiesResponse {
    /// The activities returned from the query
    pub recent: Vec<Activity>,
    /// The total number of activities the user has
    pub total: i64,
    /// The next offset to be used if there is one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[deprecated]
pub struct GetActivitiesResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<UserActivitiesResponse>,
}
