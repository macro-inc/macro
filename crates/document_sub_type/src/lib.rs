//! This crate contains the document sub type enum and various logic for it

#[cfg(test)]
mod test;

/// The document sub type enum represents all values of document sub types.
/// These values should match the `document_sub_type_value` table in macrodb.
///
/// Wire, database, and `Display` spellings are all `snake_case` so a
/// multi-word variant serializes identically in every system.
#[derive(
    serde::Serialize,
    serde::Deserialize,
    Eq,
    PartialEq,
    Debug,
    Clone,
    Copy,
    strum::EnumString,
    strum::Display,
    strum::EnumIter,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
#[cfg_attr(feature = "sqlx", derive(sqlx::Type))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(
    feature = "sqlx",
    sqlx(type_name = "\"document_sub_type_value\"", rename_all = "snake_case")
)]
pub enum DocumentSubType {
    /// A task document
    Task,
    /// A snippet document — a reusable block of markdown that can be inserted
    /// into any markdown area
    Snippet,
    /// A skill document — a markdown document containing instructions that AI
    /// can read and follow when referenced in an AI input
    Skill,
    /// The description document of an initiative.
    InitiativeDescription,
}
