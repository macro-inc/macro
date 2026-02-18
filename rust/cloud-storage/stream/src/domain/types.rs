use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct StreamId {
    pub entity_type: EntityType,
    pub entity_id: String,
    pub stream_id: String,
}

pub type Result<T> = std::result::Result<T, StreamServiceError>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamItem {
    pub id: StreamId,
    pub payload: serde_json::Value,
}

impl StreamItem {
    pub fn new(id: StreamId, payload: serde_json::Value) -> Self {
        Self { id, payload }
    }
}

#[derive(Debug, Error)]
pub enum StreamServiceError {
    #[error("storage error {0}")]
    StorageError(String),
    #[error("serde error {0}")]
    SerdeError(serde_json::error::Error),
}

impl From<serde_json::error::Error> for StreamServiceError {
    fn from(value: serde_json::error::Error) -> Self {
        Self::SerdeError(value)
    }
}

impl From<sqlx::Error> for StreamServiceError {
    fn from(value: sqlx::Error) -> Self {
        Self::StorageError(value.to_string())
    }
}
