//! Project metadata model for properties service

use sqlx::FromRow;

/// Project metadata from the Project table
#[derive(Debug, Clone, FromRow)]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub parent_id: Option<String>,
}
