//! Service layer for system properties.

use models_properties::EntityType;

use crate::domain::{
    model::{EmailAttachmentInput, EmailAttachmentProperty, SystemPropertyError},
    port::{PropertyRow, SystemPropertiesRepository},
};

use super::model::SystemPropertyKey;

/// Service trait for system property operations.
pub trait SystemPropertiesService: Clone + Send + Sync + 'static {
    /// Set email attachment properties for multiple entities.
    ///
    /// Only properties that are `Some` will be updated.
    /// All properties are upserted in a single query.
    fn set_email_attachment_properties(
        &self,
        items: Vec<EmailAttachmentInput>,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;
}

/// Implementation of SystemPropertiesService using a repository.
#[derive(Debug, Clone)]
pub struct SystemPropertiesServiceImpl<R>
where
    R: SystemPropertiesRepository,
{
    repository: R,
}

impl<R> SystemPropertiesServiceImpl<R>
where
    R: SystemPropertiesRepository,
{
    /// Create a new SystemPropertiesService.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }
}

impl<R> SystemPropertiesService for SystemPropertiesServiceImpl<R>
where
    R: SystemPropertiesRepository,
{
    #[tracing::instrument(skip(self, items))]
    async fn set_email_attachment_properties(
        &self,
        items: Vec<EmailAttachmentInput>,
    ) -> Result<(), SystemPropertyError> {
        let rows: Vec<PropertyRow> = items
            .into_iter()
            .flat_map(|item| collect_email_property_rows(&item.entity_id, item.properties))
            .collect();

        self.repository.bulk_upsert_properties(rows).await
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
/// Email attachments are always applied to Document entities.
fn collect_email_property_rows(
    entity_id: &str,
    properties: EmailAttachmentProperty,
) -> Vec<PropertyRow> {
    let mut rows = Vec::new();
    let entity_type = EntityType::Document;

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
