//! Transactional composition for database rows' cells, so a batch of writes
//! commits or rolls back as one.

use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use uuid::Uuid;

/// The transaction a database's writes share. The option and cell writers
/// both run inside it, so one use case can call either within the same
/// commit. It stays opaque; adapters choose its implementation.
pub trait DatabaseWriteTransaction: Send + Sync + 'static {
    /// Adapter-owned transaction handle.
    type Transaction: Send;
    /// Persistence or decoding error.
    type Err: std::error::Error + Send + Sync + 'static;
}

/// Lets a composition root write entity properties within an owning use
/// case's transaction.
pub trait DatabaseCellWriter: DatabaseWriteTransaction {
    /// Whether an entity outside `rows` references one of these database rows.
    /// The caller holds the target row locks against relation assignments.
    fn database_rows_referenced_in(
        &self,
        transaction: &mut Self::Transaction,
        rows: &[String],
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Set one entity property, or with `None` clear its value.
    fn upsert_entity_property_in(
        &self,
        transaction: &mut Self::Transaction,
        entity: &EntityReference,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// What these entities of one type hold, read inside the transaction so
    /// a use case sees what its own locks guard: each entity's properties
    /// with a value, or only those of `definitions` when given, as
    /// `(entity id, definition, value)`. An undecodable value is left out.
    fn entity_values_in(
        &self,
        transaction: &mut Self::Transaction,
        entity_type: EntityType,
        entity_ids: &[String],
        definitions: Option<&[Uuid]>,
    ) -> impl Future<Output = Result<Vec<(String, Uuid, PropertyValue)>, Self::Err>> + Send;
}
