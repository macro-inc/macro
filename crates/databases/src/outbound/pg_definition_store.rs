//! Postgres implementation of the [`ColumnDefinitionStore`] port.
//!
//! A database column IS a `property_definitions` row. Definitions created for a
//! column are owned by the database (`database_id` set, `user_id`/`team_id`
//! NULL, `is_system` false), which keeps them out of the shared user/team
//! property namespace — see
//! `crates/macro_db_client/migrations/20260918183705_add_database_property_owner.up.sql`.
//!
//! Mechanics only: policy (who may bind what) lives in the domain service.

#[cfg(test)]
mod test;

use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::{DataType, EntityType, db};
use properties::domain::ports::PropertiesRepo;
use properties::outbound::property_option_queries::{
    create_property_option, get_property_options, get_property_options_batch,
};
use sqlx::PgPool;

use crate::domain::models::{ColumnBinding, DatabaseId, PropertyDefinitionId, Viewer};
use crate::domain::ports::ColumnDefinitionStore;

/// Errors from the Postgres column-definition store.
#[derive(Debug, thiserror::Error)]
pub enum PgDefinitionStoreError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
    /// Failure from the owning properties domain.
    #[error("properties error: {0}")]
    Properties(#[source] anyhow::Error),
    /// A binding referenced a property definition that does not exist.
    #[error("property definition {0} not found")]
    NotFound(PropertyDefinitionId),
    /// A stored option row could not be decoded into a `PropertyOption`.
    #[error("malformed property option: {0}")]
    MalformedOption(String),
}

/// The `properties` option helpers are anyhow-typed; their only failure modes
/// are a query error and a malformed option row.
fn from_properties_error(error: anyhow::Error) -> PgDefinitionStoreError {
    match error.downcast::<sqlx::Error>() {
        Ok(sqlx_error) => PgDefinitionStoreError::Sqlx(sqlx_error),
        Err(other) => PgDefinitionStoreError::MalformedOption(other.to_string()),
    }
}

/// [`ColumnDefinitionStore`] backed by MacroDB's `property_definitions` and
/// `property_options` tables.
#[derive(Debug, Clone)]
pub struct PgDefinitionStore<P> {
    pool: PgPool,
    properties: P,
}

impl<P: PropertiesRepo<Err = anyhow::Error>> PgDefinitionStore<P> {
    /// Create a store with the owning properties domain port.
    pub fn new(pool: PgPool, properties: P) -> Self {
        Self { pool, properties }
    }

    /// Insert a definition owned by `database_id`, returning its id.
    async fn create_database_definition(
        &self,
        database_id: DatabaseId,
        name: &str,
        data_type: DataType,
        is_multi_select: bool,
    ) -> Result<PropertyDefinitionId, PgDefinitionStoreError> {
        self.properties
            .create_database_property_definition(
                database_id,
                name,
                data_type,
                is_multi_select,
                None,
            )
            .await
            .map(|definition| definition.id)
            .map_err(PgDefinitionStoreError::Properties)
    }
}

impl<P: PropertiesRepo<Err = anyhow::Error>> ColumnDefinitionStore for PgDefinitionStore<P> {
    type Err = PgDefinitionStoreError;

    #[tracing::instrument(skip(self), err)]
    async fn resolve_binding(
        &self,
        database_id: DatabaseId,
        viewer: &Viewer,
        binding: &ColumnBinding,
    ) -> Result<PropertyDefinitionId, Self::Err> {
        match binding {
            // Options are attached separately, through
            // [`ColumnDefinitionStore::add_options`], once the definition exists.
            ColumnBinding::NewDefinition {
                name,
                data_type,
                is_multi_select,
                options: _,
            } => {
                self.create_database_definition(database_id, name, *data_type, *is_multi_select)
                    .await
            }
            ColumnBinding::ExistingDefinition(id) => {
                // Only definitions the viewer can already see may be bound:
                // system-owned, their own, one of their teams', or this
                // database's. Anything else is indistinguishable from missing.
                let user_id: &str = viewer.user_id.as_ref();
                sqlx::query_scalar!(
                    r#"
                    SELECT id
                    FROM property_definitions
                    WHERE id = $1
                      AND (
                        is_system
                        OR user_id = $2
                        OR database_id = $3
                        OR team_id IN (SELECT team_id FROM team_user WHERE user_id = $2)
                      )
                    "#,
                    id,
                    user_id,
                    database_id,
                )
                .fetch_optional(&self.pool)
                .await?
                .ok_or(PgDefinitionStoreError::NotFound(*id))
            }
        }
    }

    async fn create_inferred_definition(
        &self,
        database_id: DatabaseId,
        name: &str,
        data_type: DataType,
        specific_entity_type: Option<EntityType>,
    ) -> Result<PropertyDefinitionWithOptions, Self::Err> {
        let definition = self
            .properties
            .create_database_property_definition(
                database_id,
                name,
                data_type,
                false,
                specific_entity_type,
            )
            .await
            .map_err(PgDefinitionStoreError::Properties)?;
        Ok(PropertyDefinitionWithOptions {
            definition,
            property_options: Vec::new(),
        })
    }

    async fn delete_unused_definition(&self, id: PropertyDefinitionId) -> Result<(), Self::Err> {
        self.properties
            .delete_property_definition(id)
            .await
            .map_err(PgDefinitionStoreError::Properties)
    }

    #[tracing::instrument(skip(self), err)]
    async fn add_options(
        &self,
        definition_id: PropertyDefinitionId,
        values: &[PropertyOptionValue],
    ) -> Result<Vec<PropertyOption>, Self::Err> {
        if values.is_empty() {
            return Ok(Vec::new());
        }
        // New options go after the ones already there, so the order the user
        // sees (and the labels the catalog derives from it) is stable.
        let mut display_order = get_property_options(&self.pool, definition_id)
            .await
            .map_err(from_properties_error)?
            .iter()
            .map(|option| option.display_order)
            .max()
            .map_or(0, |highest| highest + 1);

        let mut created = Vec::with_capacity(values.len());
        for value in values {
            created.push(
                create_property_option(
                    &self.pool,
                    definition_id,
                    display_order,
                    value.clone(),
                    None,
                )
                .await
                .map_err(from_properties_error)?,
            );
            display_order += 1;
        }
        Ok(created)
    }

    #[tracing::instrument(skip(self), err)]
    async fn definitions(
        &self,
        ids: &[PropertyDefinitionId],
    ) -> Result<Vec<PropertyDefinitionWithOptions>, Self::Err> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let rows = sqlx::query!(
            r#"
            SELECT
                id,
                team_id,
                user_id,
                database_id,
                display_name,
                data_type as "data_type: DataType",
                is_multi_select,
                specific_entity_type as "specific_entity_type: Option<EntityType>",
                created_at,
                updated_at,
                is_system
            FROM property_definitions
            WHERE id = ANY($1)
            "#,
            ids
        )
        .fetch_all(&self.pool)
        .await?;

        let mut options = get_property_options_batch(&self.pool, ids)
            .await
            .map_err(from_properties_error)?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let id = row.id;
                let definition = PropertyDefinition::from(db::PropertyDefinition {
                    id,
                    team_id: row.team_id,
                    user_id: row.user_id,
                    database_id: row.database_id,
                    display_name: row.display_name,
                    data_type: row.data_type,
                    is_multi_select: row.is_multi_select,
                    specific_entity_type: row.specific_entity_type.flatten(),
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    is_system: row.is_system,
                });
                PropertyDefinitionWithOptions {
                    definition,
                    property_options: options.remove(&id).unwrap_or_default(),
                }
            })
            .collect())
    }
}
