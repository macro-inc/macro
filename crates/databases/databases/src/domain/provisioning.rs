//! Atomic database provisioning for domains that own a database's lifecycle.

use models_databases::{ColumnId, DatabaseId, TableId};
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::{DataType, EntityType};
use uuid::Uuid;

/// A column to provision in core storage.
pub struct ProvisionedColumn {
    /// Stable placement identity.
    pub id: ColumnId,
    /// Display name.
    pub name: String,
    /// Cell type.
    pub data_type: DataType,
    /// Referenced entity type, for entity columns.
    pub entity_type: Option<EntityType>,
    /// Initial select options, copied into this database.
    pub options: Vec<(Uuid, PropertyOptionValue)>,
    /// Whether rows may omit this cell.
    pub nullable: bool,
    /// Schema operations reserved by the owning feature.
    pub protections: Vec<super::models::ColumnProtection>,
}

/// A complete initial schema; the owning domain supplies the policy.
pub struct StorageBlueprint {
    /// Database identity.
    pub id: DatabaseId,
    /// Initial table identity.
    pub table_id: TableId,
    /// Initial column definitions in display order.
    pub columns: Vec<ProvisionedColumn>,
}

/// Transactional port used by an owning domain's repository.
pub trait DatabaseStorageProvisioner: super::ports::DatabaseStorage {
    /// Opaque transaction supplied by the adapter.
    type Transaction: Send;
    /// Provision all database-owned storage in the caller's transaction.
    fn create_storage_in(
        &self,
        transaction: &mut Self::Transaction,
        database: &StorageBlueprint,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
}
