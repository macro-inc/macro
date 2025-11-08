use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Clone, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SoupProject {
    /// The id of the project
    pub id: String,

    /// The name of the project
    pub name: String,

    /// The user id of who created the project
    pub owner_id: String,

    /// The parent project id
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,

    /// The time the project was created
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    pub created_at: chrono::DateTime<Utc>,

    /// The time the project was updated
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the document was last viewed
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub viewed_at: Option<chrono::DateTime<Utc>>,
}

pub fn map_soup_project(
    id: String,
    owner: String,
    name: String,
    parent_id: Option<String>,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
    viewed_at: Option<chrono::DateTime<Utc>>,
) -> SoupProject {
    SoupProject {
        id,
        owner_id: owner,
        name,
        parent_id,
        created_at,
        updated_at,
        viewed_at,
    }
}
