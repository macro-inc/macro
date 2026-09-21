use models_properties::db;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::{DataType, EntityType};
use sqlx::{Postgres, Transaction};

use super::properties_pg_repo::PropertiesPgRepo;
use crate::domain::database_definition_writer::{DatabaseDefinitionWriter, NewDatabaseDefinition};

/// Database schema write failures retain their original SQL or conversion cause.
#[derive(Debug, thiserror::Error)]
pub enum DatabaseDefinitionWriteError {
    /// Database rejected a definition or option.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// A returned option did not represent a typed value.
    #[error("invalid option: {0}")]
    Option(String),
}

impl DatabaseDefinitionWriter for PropertiesPgRepo {
    type Transaction = Transaction<'static, Postgres>;
    type Err = DatabaseDefinitionWriteError;

    async fn create_database_definition_in(
        &self,
        transaction: &mut Self::Transaction,
        input: NewDatabaseDefinition<'_>,
    ) -> Result<PropertyDefinitionWithOptions, Self::Err> {
        let id = macro_uuid::generate_uuid_v7();
        let definition = sqlx::query_as!(db::PropertyDefinition,
            r#"INSERT INTO property_definitions (id, database_id, display_name, data_type, is_multi_select, specific_entity_type)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id, team_id, user_id, database_id, display_name,
               data_type AS "data_type: DataType", is_multi_select,
               specific_entity_type AS "specific_entity_type: EntityType", created_at, updated_at, is_system"#,
            id, input.database_id, input.name, input.data_type as DataType,
            input.is_multi_select, input.specific_entity_type as Option<EntityType>,
        ).fetch_one(&mut **transaction).await?;
        let mut property_options = Vec::with_capacity(input.options.len());
        for (index, label) in input.options.iter().enumerate() {
            let option_id = macro_uuid::generate_uuid_v7();
            let option = sqlx::query_as!(db::PropertyOption,
                r#"INSERT INTO property_options (id, property_definition_id, display_order, string_value)
                   VALUES ($1, $2, $3, $4)
                   RETURNING id, property_definition_id, display_order, number_value, string_value, color, created_at, updated_at"#,
                option_id, id, index as i32, label,
            ).fetch_one(&mut **transaction).await?;
            property_options.push(option.try_into().map_err(
                |error: models_properties::db::error::DbConversionError| {
                    DatabaseDefinitionWriteError::Option(error.to_string())
                },
            )?);
        }
        Ok(PropertyDefinitionWithOptions {
            definition: definition.into(),
            property_options,
        })
    }
}
