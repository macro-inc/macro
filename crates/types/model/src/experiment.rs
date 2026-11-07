use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Experiment {
    /// The id of the experiment
    pub id: String,
    /// Whether the experiment is active
    pub active: bool,
    /// The date the experiment was started
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The date the experiment was ended
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
}
