//! Service layer for system properties.

use models_properties::EntityType;

use crate::domain::{
    model::{
        EmailAttachmentInput, EmailAttachmentProperty, PropertyRow, SystemPropertyError,
        SystemPropertyKey,
    },
    port::SystemPropertiesRepository,
};

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

/// Collect property rows for a single entity's email attachment properties.
/// Email attachments are always applied to Document entities.
fn collect_email_property_rows(
    entity_id: &str,
    properties: EmailAttachmentProperty,
) -> Vec<PropertyRow> {
    let mut rows = Vec::new();
    let entity_type = EntityType::Document;

    // Source (single entity reference with optional specific_message_id)
    if let Some(source) = properties.source {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Source.uuid(),
            source.entity_type,
            vec![source.entity_id],
            source.specific_message_id,
        ));
    }

    // Companies (multi entity reference)
    if let Some(company_ids) = properties.companies {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Companies.uuid(),
            EntityType::Company,
            company_ids,
            None,
        ));
    }

    // Sender (single user reference)
    if let Some(user_id) = properties.sender {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Sender.uuid(),
            EntityType::User,
            vec![user_id],
            None,
        ));
    }

    // Recipients (multi user reference)
    if let Some(user_ids) = properties.recipients {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Recipients.uuid(),
            EntityType::User,
            user_ids,
            None,
        ));
    }

    // Subject (string)
    if let Some(subject) = properties.subject {
        rows.push(PropertyRow::string_value(
            entity_id,
            entity_type,
            SystemPropertyKey::Subject.uuid(),
            subject,
        ));
    }

    rows
}
