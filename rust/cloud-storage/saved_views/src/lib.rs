mod pgsql;
mod storage;
use chrono::{DateTime, Utc};
use macro_uuid::generate_uuid_v7;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub use pgsql::*;
pub use storage::*;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: Uuid,
    pub user_id: String,
    pub name: String,
    /// It is an explicit choice that the structure of the view configuration
    /// is up to the frontend. The structure and composition of view configuration
    /// is still very much in flux.
    pub config: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl View {
    pub fn new(user_id: String, name: String, config: serde_json::Value) -> Self {
        let now = Utc::now();
        Self {
            id: generate_uuid_v7(),
            user_id,
            name,
            config,
            created_at: now,
            updated_at: now,
        }
    }
}

/// Frontend can define any set of its own default views for the user.
/// This is a list of views that are excluded from the default views list on the frontend.
///
/// It is important that the frontend can quickly iterate on default views, for that reason
/// we don't keep track of default views in the database, only those that are explicitly excluded.
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedDefaultView {
    id: Uuid,
    pub user_id: String,
    pub default_view_id: String,
}

impl ExcludedDefaultView {
    pub fn new(user_id: String, default_view_id: String) -> Self {
        Self {
            id: generate_uuid_v7(),
            user_id,
            default_view_id,
        }
    }
}
