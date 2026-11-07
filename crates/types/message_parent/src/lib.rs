//! The entity a message belongs to, shared by the message store and the
//! crates that only need to name a parent (Lexical rendering, mentions).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A validated document identifier. Historical document ids need not be UUIDs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct DocumentId(String);

impl TryFrom<String> for DocumentId {
    type Error = InvalidParent;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() || value.trim() != value || value.chars().any(char::is_control) {
            return Err(InvalidParent);
        }
        Ok(Self(value))
    }
}

impl From<DocumentId> for String {
    fn from(value: DocumentId) -> Self {
        value.0
    }
}

/// Invalid or unsupported message parent.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("invalid message parent")]
pub struct InvalidParent;

/// The entity whose permissions and lifecycle govern a message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", content = "id", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub enum MessageParent {
    /// A channel, including direct messages.
    Channel(Uuid),
    /// A document, including tasks and PDFs.
    Document(DocumentId),
    /// An initiative, presented as a project in the application.
    Initiative(Uuid),
    /// A CRM company.
    CrmCompany(Uuid),
    /// A CRM contact.
    CrmContact(Uuid),
    /// A video call and its persistent chat thread.
    Call(Uuid),
}

impl MessageParent {
    /// Parse a persisted or URL parent reference.
    pub fn parse(entity_type: &str, entity_id: &str) -> Result<Self, InvalidParent> {
        match entity_type {
            "channel" => Ok(Self::Channel(entity_id.parse().map_err(|_| InvalidParent)?)),
            "document" => Ok(Self::Document(entity_id.to_owned().try_into()?)),
            "initiative" => Ok(Self::Initiative(
                entity_id.parse().map_err(|_| InvalidParent)?,
            )),
            "crm_company" => Ok(Self::CrmCompany(
                entity_id.parse().map_err(|_| InvalidParent)?,
            )),
            "crm_contact" => Ok(Self::CrmContact(
                entity_id.parse().map_err(|_| InvalidParent)?,
            )),
            "call" => Ok(Self::Call(entity_id.parse().map_err(|_| InvalidParent)?)),
            _ => Err(InvalidParent),
        }
    }

    /// Canonical parent type used in persistence and routes.
    pub fn entity_type(&self) -> &'static str {
        match self {
            Self::Channel(_) => "channel",
            Self::Document(_) => "document",
            Self::Initiative(_) => "initiative",
            Self::CrmCompany(_) => "crm_company",
            Self::CrmContact(_) => "crm_contact",
            Self::Call(_) => "call",
        }
    }

    /// Canonical parent identifier.
    pub fn entity_id(&self) -> String {
        match self {
            Self::Channel(id)
            | Self::Call(id)
            | Self::Initiative(id)
            | Self::CrmCompany(id)
            | Self::CrmContact(id) => id.to_string(),
            Self::Document(id) => id.0.clone(),
        }
    }

    /// Whether messages are presented as comments on an entity.
    pub fn is_discussion(&self) -> bool {
        !matches!(self, Self::Channel(_) | Self::Call(_))
    }

    /// Entity type whose permissions govern messages on this parent.
    pub fn access_entity_type(&self) -> model_entity::EntityType {
        match self {
            Self::Channel(_) => model_entity::EntityType::Channel,
            Self::Document(_) => model_entity::EntityType::Document,
            Self::Initiative(_) => model_entity::EntityType::Initiative,
            Self::CrmCompany(_) => model_entity::EntityType::CrmCompany,
            Self::CrmContact(_) => model_entity::EntityType::CrmContact,
            Self::Call(_) => model_entity::EntityType::Call,
        }
    }
}
