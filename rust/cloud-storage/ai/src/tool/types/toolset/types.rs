use super::tool_object::ValidationError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ToolSetCreationError {
    #[error("error validating schema")]
    Validation(ValidationError),
    #[error("two or more tools have the same name")]
    NameConflict(String),
}

#[derive(Debug, Error)]
pub enum ToolCallError {
    #[error("error deserializing tool call (possible hallucination)")]
    Deserialization(serde_json::Error),
    #[error("tool not in toolset")]
    NotFound(String),
}
