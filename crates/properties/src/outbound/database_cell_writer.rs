use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::entity_property_queries;
use super::properties_pg_repo::PropertiesPgRepo;
use super::query_error::PropertyQueryError;
use crate::domain::database_cell_writer::{DatabaseCellWriter, DatabaseWriteTransaction};

impl DatabaseWriteTransaction for PropertiesPgRepo {
    type Transaction = Transaction<'static, Postgres>;
    type Err = PropertyQueryError;
}

impl DatabaseCellWriter for PropertiesPgRepo {
    async fn database_rows_referenced_in(
        &self,
        transaction: &mut Self::Transaction,
        rows: &[String],
    ) -> Result<bool, Self::Err> {
        Ok(sqlx::query_scalar!(
            r#"SELECT EXISTS (
                SELECT 1 FROM entity_properties,
                LATERAL jsonb_array_elements(CASE WHEN values ->> 'type' = 'EntityReference'
                    THEN values -> 'value' ELSE '[]'::jsonb END) AS reference
                WHERE reference ->> 'entity_type' = 'DATABASE_ROW'
                  AND reference ->> 'entity_id' = ANY($1)
                  AND NOT (entity_type = 'DATABASE_ROW' AND entity_id = ANY($1))
            ) AS "used!""#,
            rows
        )
        .fetch_one(&mut **transaction)
        .await?)
    }

    async fn upsert_entity_property_in(
        &self,
        transaction: &mut Self::Transaction,
        entity: &EntityReference,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> Result<(), Self::Err> {
        entity_property_queries::upsert_entity_property_in_transaction(
            transaction,
            &entity.entity_id,
            entity.entity_type,
            property_definition_id,
            value,
        )
        .await?;
        Ok(())
    }

    async fn entity_values_in(
        &self,
        transaction: &mut Self::Transaction,
        entity_type: EntityType,
        entity_ids: &[String],
        definitions: Option<&[Uuid]>,
    ) -> Result<Vec<(String, Uuid, PropertyValue)>, Self::Err> {
        entity_property_queries::entity_values_in_transaction(
            transaction,
            entity_type,
            entity_ids,
            definitions,
        )
        .await
    }
}
