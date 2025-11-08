use serde_json::Error as JsonError;
use serde_json::Value;
use thiserror::Error;

pub struct ToolObject<T> {
    pub input_schema: Value,
    pub output_schema: Value,
    pub description: String,
    pub name: String,
    pub deserializer: T,
}

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("missing metadata")]
    MissingMetadata,
    #[error("could not convert to json")]
    JsonSerialization(JsonError),
    #[error("schema exceeds depth one - nested objects with properties are not allowed")]
    ExceedsDepthOne,
    #[error("title is empty")]
    EmptyTitle,
    #[error("schema must not have oneOf set. Do not use descriptions or /// on enum types.")]
    OneOf,
}
