use serde_json::Error as JsonError;
use serde_json::Map;
use serde_json::Value;
use thiserror::Error;

/// A compiled tool object containing schema and deserialization logic.
///
/// `ToolObject` holds the metadata and deserializer for a tool, allowing
/// it to be invoked with JSON input at runtime.
pub struct ToolObject<T> {
    /// The JSON schema describing the tool's input parameters.
    pub input_schema: Map<String, Value>,
    /// The JSON schema describing the tool's output.
    pub output_schema: Value,
    /// A human-readable description of what the tool does.
    pub description: String,
    /// The unique name of the tool.
    pub name: String,
    /// The deserializer function for converting JSON to the tool type.
    pub deserializer: T,
}

/// Errors that can occur when validating a tool's schema.
#[derive(Debug, Error)]
pub enum ValidationError {
    /// The schema is missing required metadata (title or description).
    #[error("missing metadata")]
    MissingMetadata,
    /// Failed to serialize the schema to JSON.
    #[error("could not convert to json")]
    JsonSerialization(JsonError),
    /// The schema contains nested objects which are not supported.
    #[error("schema exceeds depth one - nested objects with properties are not allowed")]
    ExceedsDepthOne,
    /// The schema title is empty.
    #[error("title is empty")]
    EmptyTitle,
    /// The schema contains `oneOf` which is not supported for AI tools.
    #[error("schema must not have oneOf set. Do not use descriptions or /// on enum types.")]
    OneOf,
    /// Schema must be a serde_json::Value::Object
    #[error("schema must be a serde_json::Value::Object")]
    ExpectedObject,
}
