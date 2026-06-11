//! This crate contains the document sub type enum and various logic for it
use schemars::JsonSchema;

/// The document sub type enum represents all values of document sub types.
/// These values should match the `document_sub_type_value` table in macrodb.
#[derive(
    serde::Serialize,
    serde::Deserialize,
    Eq,
    PartialEq,
    Debug,
    utoipa::ToSchema,
    Clone,
    Copy,
    sqlx::Type,
    strum::EnumString,
    strum::Display,
    JsonSchema,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "snake_case")]
#[sqlx(type_name = "\"document_sub_type_value\"", rename_all = "lowercase")]
pub enum DocumentSubType {
    /// A task document
    Task,
    /// A snippet document — a reusable block of markdown that can be inserted
    /// into any markdown area
    Snippet,
}
