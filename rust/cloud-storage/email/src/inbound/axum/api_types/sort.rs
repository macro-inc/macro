use models_pagination::SimpleSortMethod;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// common types of sorts based on timestamps
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiSortMethod {
    /// we are sorting by the viewed_at time
    ViewedAt,
    /// we are sorting by the updated_at time
    UpdatedAt,
    /// we are sorting by the created_at time
    CreatedAt,
    /// we are sorting by the viewed/updated time
    ViewedUpdated,
}

impl ApiSortMethod {
    pub fn into_simple_sort(self) -> SimpleSortMethod {
        match self {
            ApiSortMethod::ViewedAt => SimpleSortMethod::ViewedAt,
            ApiSortMethod::UpdatedAt => SimpleSortMethod::UpdatedAt,
            ApiSortMethod::CreatedAt => SimpleSortMethod::CreatedAt,
            ApiSortMethod::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
}
