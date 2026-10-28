//! Entity type shared across database, service, and API layers.

use document_sub_type::DocumentSubType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Type of entity that can be referenced by entity properties.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    ToSchema,
    PartialEq,
    Eq,
    Hash,
    sqlx::Type,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "snake_case", ascii_case_insensitive)]
#[sqlx(
    type_name = "property_entity_type",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum EntityType {
    CalendarEvent,
    CallRecord,
    Channel,
    Chat,
    /// CRM company.
    Company,
    /// A row of a Macro database table; its cells are its properties.
    DatabaseRow,
    /// CRM contact.
    Contact,
    Document,
    /// Initiative, displayed as a Project in the application.
    Initiative,
    Project,
    Task,
    Thread,
    User,
}

impl From<DocumentSubType> for EntityType {
    fn from(sub_type: DocumentSubType) -> Self {
        match sub_type {
            DocumentSubType::Task => EntityType::Task,
            DocumentSubType::Snippet
            | DocumentSubType::Skill
            | DocumentSubType::InitiativeDescription => EntityType::Document,
        }
    }
}
