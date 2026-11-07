use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use sqlx::{Postgres, Transaction};

use super::properties_pg_repo::PropertiesPgRepo;
use super::property_definition_queries;
use super::property_option_queries;
use super::query_error::PropertyQueryError;
use crate::TagColor;
use crate::domain::database_definition_writer::{DatabaseDefinitionWriter, NewDatabaseDefinition};

impl DatabaseDefinitionWriter for PropertiesPgRepo {
    type Transaction = Transaction<'static, Postgres>;
    type Err = PropertyQueryError;

    async fn create_database_definition_in(
        &self,
        transaction: &mut Self::Transaction,
        input: NewDatabaseDefinition<'_>,
    ) -> Result<PropertyDefinitionWithOptions, Self::Err> {
        let definition = property_definition_queries::create_database_property_definition(
            &mut **transaction,
            input.id,
            input.database_id,
            input.name,
            input.data_type,
            input.is_multi_select,
            input.specific_entity_type,
        )
        .await?;
        let mut property_options = Vec::with_capacity(input.options.len());
        for (position, (id, value)) in input.options.iter().enumerate() {
            property_options.push(
                property_option_queries::insert_property_option(
                    &mut **transaction,
                    *id,
                    definition.id,
                    display_order(position)?,
                    value.clone(),
                    Some(TagColor::for_position(position).hex().to_owned()),
                )
                .await?,
            );
        }
        Ok(PropertyDefinitionWithOptions {
            definition,
            property_options,
        })
    }
}

/// An option's `display_order` column for its position among its definition's options.
pub(super) fn display_order(position: usize) -> Result<i32, PropertyQueryError> {
    i32::try_from(position).map_err(|_| PropertyQueryError::DisplayOrderOverflow(position))
}
