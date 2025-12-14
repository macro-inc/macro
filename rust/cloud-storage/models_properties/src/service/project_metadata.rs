//! Project metadata model for properties service

/// Project metadata from the Project table
#[derive(Debug, Clone)]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub parent_id: Option<String>,
}
