//! PostgreSQL implementation for properties repository.

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::{entity_property_queries};
use crate::domain::ports::PropertiesRepo;

/// PostgreSQL implementation of PropertiesRepo.
#[derive(Debug, Clone)]
pub struct PropertiesPgRepo {
    pool: Pool<Postgres>,
}

impl PropertiesPgRepo {
    /// Create a new PropertiesPgRepo.
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool }
    }
}

impl PropertiesRepo for PropertiesPgRepo {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self, value))]
    async fn update_entity_property_value_if_exists(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> Result<(), Self::Err> {
        entity_property_queries::update_entity_property_value_if_exists(
            &self.pool,
            entity_id,
            entity_type,
            property_definition_id,
            value,
        )
        .await
    }
}
