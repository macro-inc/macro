//! Email attachment property types and operations.

use models_properties::EntityType;
use serde::{Deserialize, Serialize};

use super::system_property::{PropertyRow, Result, SystemProperties};
use crate::types::SystemPropertyKey;

/// Entity reference for Source property.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceEntity {
    pub entity_type: EntityType,
    pub entity_id: String,
    /// For CHANNEL, CHAT, THREAD entity types - optional specific message ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specific_message_id: Option<String>,
}

/// Email attachment properties to set on an entity.
#[derive(Debug, Clone, Default)]
pub struct EmailAttachmentProperty {
    /// Source entity reference (single).
    pub source: Option<SourceEntity>,
    /// Company entity IDs.
    pub companies: Option<Vec<String>>,
    /// Sender user ID.
    pub sender: Option<String>,
    /// Recipient user IDs.
    pub recipients: Option<Vec<String>>,
    /// Subject line.
    pub subject: Option<String>,
}

/// Input for bulk email attachment property setting.
#[derive(Debug, Clone)]
pub struct EmailAttachmentInput {
    pub entity_id: String,
    pub entity_type: EntityType,
    pub properties: EmailAttachmentProperty,
}

impl SystemProperties {
    /// Set email attachment properties.
    ///
    /// Only properties that are `Some` will be updated.
    /// All properties are upserted in a single query.
    #[tracing::instrument(skip(self, items))]
    pub async fn set_email_attachment_properties(
        &self,
        items: Vec<EmailAttachmentInput>,
    ) -> Result<()> {
        let rows: Vec<PropertyRow> = items
            .into_iter()
            .flat_map(|item| {
                collect_email_property_rows(&item.entity_id, item.entity_type, item.properties)
            })
            .collect();

        self.bulk_upsert_properties(&rows).await
    }
}

/// Build EntityReference JSON value from entity type and IDs.
fn entity_refs_json(ref_type: EntityType, ids: Vec<String>) -> serde_json::Value {
    let refs: Vec<serde_json::Value> = ids
        .into_iter()
        .map(|id| {
            serde_json::json!({
                "entity_type": ref_type,
                "entity_id": id
            })
        })
        .collect();

    serde_json::json!({
        "type": "EntityReference",
        "value": refs
    })
}

/// Collect property rows for a single entity's email attachment properties.
fn collect_email_property_rows(
    entity_id: &str,
    entity_type: EntityType,
    properties: EmailAttachmentProperty,
) -> Vec<PropertyRow> {
    let mut rows = Vec::new();

    // Source (single entity reference)
    if let Some(source) = properties.source {
        rows.push(PropertyRow {
            entity_id: entity_id.to_string(),
            entity_type,
            property_definition_id: SystemPropertyKey::Source.uuid(),
            values: serde_json::json!({
                "type": "EntityReference",
                "value": [source]
            }),
        });
    }

    // Companies (multi entity reference)
    if let Some(company_ids) = properties.companies {
        rows.push(PropertyRow {
            entity_id: entity_id.to_string(),
            entity_type,
            property_definition_id: SystemPropertyKey::Companies.uuid(),
            values: entity_refs_json(EntityType::Company, company_ids),
        });
    }

    // Sender (single user reference)
    if let Some(user_id) = properties.sender {
        rows.push(PropertyRow {
            entity_id: entity_id.to_string(),
            entity_type,
            property_definition_id: SystemPropertyKey::Sender.uuid(),
            values: entity_refs_json(EntityType::User, vec![user_id]),
        });
    }

    // Recipients (multi user reference)
    if let Some(user_ids) = properties.recipients {
        rows.push(PropertyRow {
            entity_id: entity_id.to_string(),
            entity_type,
            property_definition_id: SystemPropertyKey::Recipients.uuid(),
            values: entity_refs_json(EntityType::User, user_ids),
        });
    }

    // Subject (string)
    if let Some(subject) = properties.subject {
        rows.push(PropertyRow {
            entity_id: entity_id.to_string(),
            entity_type,
            property_definition_id: SystemPropertyKey::Subject.uuid(),
            values: serde_json::json!({
                "type": "String",
                "value": subject
            }),
        });
    }

    rows
}
