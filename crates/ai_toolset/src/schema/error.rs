use serde_json::Error as JsonError;
use thiserror::Error;

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
    /// The schema contains a `$ref`, which means a recursive type survived
    /// inlining. Strict tool use cannot express recursive schemas.
    #[error(
        "schema contains $ref — recursive types cannot be inlined and are not supported by strict tool use"
    )]
    UnsupportedRef,
    /// An object's `additionalProperties` is not `false` — map types with
    /// arbitrary keys cannot be expressed in strict mode.
    #[error(
        "additionalProperties must be false — map types (e.g. HashMap) are not supported by strict tool use; use a Vec of key/value structs instead"
    )]
    AdditionalProperties,
    /// An `enum` contains object or array values; strict mode only allows
    /// primitive enum members.
    #[error("enum values must be primitives (string, number, bool, or null)")]
    ComplexEnum,
    /// The root of a tool input schema must be an object.
    #[error("tool input schema root must have type \"object\"")]
    RootNotObject,
}
