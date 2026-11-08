//! The entity a message belongs to, shared by the message store and the
//! crates that only need to name a parent (Lexical rendering, mentions).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

pub use document_id::DocumentId;

/// Invalid or unsupported message parent.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("invalid message parent")]
pub struct InvalidParent;

impl From<document_id::InvalidDocumentId> for InvalidParent {
    fn from(_: document_id::InvalidDocumentId) -> Self {
        Self
    }
}

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
            Self::Document(id) => id.as_str().to_owned(),
        }
    }

    /// Whether messages are presented as comments on an entity.
    pub fn is_discussion(&self) -> bool {
        !matches!(self, Self::Channel(_) | Self::Call(_))
    }

    /// Entity type whose permissions govern messages on this parent.
    pub fn access_entity_type(&self) -> entity_kind::EntityType {
        match self {
            Self::Channel(_) => entity_kind::EntityType::Channel,
            Self::Document(_) => entity_kind::EntityType::Document,
            Self::Initiative(_) => entity_kind::EntityType::Initiative,
            Self::CrmCompany(_) => entity_kind::EntityType::CrmCompany,
            Self::CrmContact(_) => entity_kind::EntityType::CrmContact,
            Self::Call(_) => entity_kind::EntityType::Call,
        }
    }
}
