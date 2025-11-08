use chrono::serde::ts_seconds_option;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Experiment {
    /// The id of the experiment
    pub id: String,
    /// Whether the experiment is active
    pub active: bool,
    /// The date the experiment was started
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=true)]
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The date the experiment was ended
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=true)]
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentOperation {
    /// Starts an experiment
    Start,
    /// Ends an experiment
    End,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ExperimentLog {
    /// The id of the experiment
    pub experiment_id: String,
    /// The id of the user
    pub user_id: String,
    /// The group the experiment belongs to, can either be 'A' or 'B'
    pub experiment_group: String,
    /// Whether the user has completed the experiment
    pub completed: bool,
}
