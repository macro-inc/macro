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
use models_properties::{DataType, EntityType, db};
use properties::outbound::property_option_queries::get_property_options_batch;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{ColumnBinding, DatabaseId, PropertyDefinitionId};
use crate::domain::ports::ColumnDefinitionStore;

/// Errors from the Postgres column-definition store.
#[derive(Debug, thiserror::Error)]
pub enum PgDefinitionStoreError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
    /// A binding referenced a property definition that does not exist.
    #[error("property definition {0} not found")]
    NotFound(PropertyDefinitionId),
    /// A stored option row could not be decoded into a `PropertyOption`.
    #[error("malformed property option: {0}")]
    MalformedOption(String),
}

/// [`ColumnDefinitionStore`] backed by MacroDB's `property_definitions` and
/// `property_options` tables.
#[derive(Debug, Clone)]
pub struct PgDefinitionStore {
    pool: PgPool,
}

impl PgDefinitionStore {
    /// Create a store over the given pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a definition owned by `database_id`, returning its id.
    async fn create_database_definition(
        &self,
        database_id: DatabaseId,
        name: &str,
        data_type: DataType,
        is_multi_select: bool,
    ) -> Result<PropertyDefinitionId, PgDefinitionStoreError> {
        // `properties::create_property_definition` cannot be reused here: its
        // `PropertyDefinitionOwner` encodes the "user or team" invariant and has
        // no database arm, so a database-owned insert is written out directly.
        let id = macro_uuid::generate_uuid_v7();
        sqlx::query_scalar!(
            r#"
            INSERT INTO property_definitions (
                id,
                database_id,
                display_name,
                data_type,
                is_multi_select,
                is_system
            )
            VALUES ($1, $2, $3, $4, $5, FALSE)
            RETURNING id
            "#,
            id,
            database_id,
            name,
            data_type as DataType,
            is_multi_select,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(Into::into)
    }
}

impl ColumnDefinitionStore for PgDefinitionStore {
    type Err = PgDefinitionStoreError;

    #[tracing::instrument(skip(self), err)]
    async fn resolve_binding(
        &self,
        database_id: DatabaseId,
        binding: &ColumnBinding,
    ) -> Result<PropertyDefinitionId, Self::Err> {
        match binding {
            ColumnBinding::NewDefinition {
                name,
                data_type,
                is_multi_select,
            } => {
                self.create_database_definition(database_id, name, *data_type, *is_multi_select)
                    .await
            }
            ColumnBinding::ExistingDefinition(id) => {
                sqlx::query_scalar!("SELECT id FROM property_definitions WHERE id = $1", id)
                    .fetch_optional(&self.pool)
                    .await?
                    .ok_or(PgDefinitionStoreError::NotFound(*id))
            }
        }
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
            .map_err(|e| {
                // The helper is anyhow-typed; its only failure modes are a query
                // error and a malformed option row.
                match e.downcast::<sqlx::Error>() {
                    Ok(sqlx_error) => PgDefinitionStoreError::Sqlx(sqlx_error),
                    Err(other) => PgDefinitionStoreError::MalformedOption(other.to_string()),
                }
            })?;

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

    #[tracing::instrument(skip(self), err)]
    async fn resolve_option(
        &self,
        definition_id: PropertyDefinitionId,
        display_value: &str,
    ) -> Result<Option<Uuid>, Self::Err> {
        // A cell arrives from SQLite as display text; a SELECT_NUMBER option
        // stores its value numerically, so the text is matched both ways.
        let number_value: Option<f64> = display_value.parse().ok();

        sqlx::query_scalar!(
            r#"
            SELECT id
            FROM property_options
            WHERE property_definition_id = $1
              AND (
                string_value = $2
                OR ($3::double precision IS NOT NULL AND number_value = $3)
              )
            ORDER BY display_order
            LIMIT 1
            "#,
            definition_id,
            display_value,
            number_value,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }
}
