use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct DocumentSummary {
    pub document_id: String,
    pub summary: String,
    pub version_id: String,
    pub created_at: Option<DateTime<Utc>>,
    pub id: Option<String>,
}
