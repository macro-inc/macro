//! Transactional composition for database-owned schema creation.

use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::{DataType, EntityType};
use uuid::Uuid;

/// Definition input owned by the properties domain.
pub struct NewDatabaseDefinition<'a> {
    /// The definition's id, minted by the caller (UUIDv7) so it can name
    /// the definition before the transaction commits.
    pub id: Uuid,
    /// Owning database.
    pub database_id: Uuid,
    /// User-visible name.
    pub name: &'a str,
    /// Stored value kind.
    pub data_type: DataType,
    /// Whether more than one value is accepted.
    pub is_multi_select: bool,
    /// Optional entity-reference restriction.
    pub specific_entity_type: Option<EntityType>,
    /// Initial options in display order, each under the id the caller
    /// minted and coloured by its position.
    pub options: &'a [(Uuid, PropertyOptionValue)],
}

/// Lets a composition root create schema within an owning use case's transaction.
/// The domain keeps the transaction opaque; adapters choose its implementation.
pub trait DatabaseDefinitionWriter: Send + Sync + 'static {
    /// Adapter-owned transaction handle.
    type Transaction: Send;
    /// Persistence or decoding error.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Insert a new definition and its options atomically with the caller's data.
    fn create_database_definition_in(
        &self,
        transaction: &mut Self::Transaction,
        input: NewDatabaseDefinition<'_>,
    ) -> impl Future<Output = Result<PropertyDefinitionWithOptions, Self::Err>> + Send;
}
