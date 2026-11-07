//! CRM association input type.

use models_properties::EntityType;
use uuid::Uuid;

/// CRM companies and contacts to associate with one entity through the
/// Companies and Contacts system properties.
#[derive(Debug, Clone)]
pub struct CrmRecordLink {
    /// The entity ID to set properties on.
    pub entity_id: String,
    /// The entity's property storage type (e.g. a call record or a task).
    pub entity_type: EntityType,
    /// CRM company ids, written to the Companies property.
    pub company_ids: Vec<Uuid>,
    /// CRM contact ids, written to the Contacts property.
    pub contact_ids: Vec<Uuid>,
}
