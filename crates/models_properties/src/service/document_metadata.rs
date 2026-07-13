//! Document metadata model for properties service

/// Document metadata from the Document table
#[derive(Debug, Clone)]
pub struct DocumentMetadata {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub file_type: Option<String>,
    pub project_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}
