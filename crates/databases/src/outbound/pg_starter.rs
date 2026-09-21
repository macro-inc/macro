//! Atomic starter provisioning; foreign tables stay behind their owning ports.

#[cfg(test)]
mod test;
use entity_access_db_utils::{AccessLevel, EntityAccessSourceType};
use model_entity::EntityType;
use models_properties::DataType;
use models_properties::service::property_value::PropertyValue;
use properties::domain::database_definition_writer::{
    DatabaseDefinitionWriter, NewDatabaseDefinition,
};
use saved_views::TransactionalViewStorage;
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::models::Viewer;
use crate::domain::starter::{DatabaseStarterRepo, StarterBlueprint, StarterDatabase};

/// Errors retain the owning port's original failure.
#[derive(Debug, thiserror::Error)]
pub enum PgStarterError {
    /// Database failure rolls back the entire seed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// Property definition or saved-view writer failed.
    #[error("starter dependency failed: {0}")]
    Dependency(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// Seed cell serialization failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Composition receives owning property and saved-view ports, never constructs them.
pub struct PgDatabaseStarterRepo<Properties, Views> {
    pool: PgPool,
    properties: Properties,
    views: Views,
}

impl<Properties, Views> PgDatabaseStarterRepo<Properties, Views> {
    /// Build the atomic adapter in a composition root.
    pub fn new(pool: PgPool, properties: Properties, views: Views) -> Self {
        Self {
            pool,
            properties,
            views,
        }
    }
}

fn dependency(error: impl std::error::Error + Send + Sync + 'static) -> PgStarterError {
    PgStarterError::Dependency(Box::new(error))
}

impl<P, V> DatabaseStarterRepo for PgDatabaseStarterRepo<P, V>
where
    P: DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>,
    V: TransactionalViewStorage<Transaction = Transaction<'static, Postgres>>,
{
    type Err = PgStarterError;

    async fn ensure_starter(
        &self,
        viewer: &Viewer,
        blueprint: &StarterBlueprint,
    ) -> Result<StarterDatabase, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let user_id = viewer.user_id.as_ref();
        let claimed = sqlx::query_scalar!(
            "INSERT INTO database_starter_seeds (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id", user_id,
        ).fetch_optional(&mut *transaction).await?.is_some();
        if !claimed {
            let database_id = sqlx::query_scalar!(
                r#"SELECT d.id FROM database_starter_seeds s JOIN databases d ON d.id = s.database_id
                   WHERE s.user_id = $1 AND d.trashed_at IS NULL"#, user_id,
            ).fetch_optional(&mut *transaction).await?;
            return Ok(StarterDatabase {
                database_id,
                table_id: None,
                view_id: None,
                created: false,
            });
        }
        // Existing and trashed databases both mean the user already started.
        if sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM databases WHERE owner_id = $1) AS \"exists!\"",
            user_id
        )
        .fetch_one(&mut *transaction)
        .await?
        {
            transaction.commit().await?;
            return Ok(StarterDatabase {
                database_id: None,
                table_id: None,
                view_id: None,
                created: false,
            });
        }
        let database_id = blueprint.database_id;
        let table_id = blueprint.table_id;
        sqlx::query!(
            "INSERT INTO databases (id, name, owner_id) VALUES ($1, $2, $3)",
            database_id,
            blueprint.name,
            user_id
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!("INSERT INTO database_tables (id, database_id, name, position, version) VALUES ($1, $2, $3, '000000000001', 1)", table_id, database_id, blueprint.table_name)
            .execute(&mut *transaction).await?;
        let title = self
            .properties
            .create_database_definition_in(
                &mut transaction,
                NewDatabaseDefinition {
                    database_id,
                    name: blueprint.title_name,
                    data_type: DataType::String,
                    is_multi_select: false,
                    specific_entity_type: None,
                    options: &[],
                },
            )
            .await
            .map_err(dependency)?;
        let stage = self
            .properties
            .create_database_definition_in(
                &mut transaction,
                NewDatabaseDefinition {
                    database_id,
                    name: blueprint.stage_name,
                    data_type: DataType::SelectString,
                    is_multi_select: false,
                    specific_entity_type: None,
                    options: &blueprint.stages,
                },
            )
            .await
            .map_err(dependency)?;
        let title_column_id = macro_uuid::generate_uuid_v7();
        let stage_column_id = macro_uuid::generate_uuid_v7();
        for (column_id, definition_id, position) in [
            (title_column_id, title.definition.id, "000000000001"),
            (stage_column_id, stage.definition.id, "000000000002"),
        ] {
            sqlx::query!("INSERT INTO database_columns (id, table_id, property_definition_id, position, infer_type) VALUES ($1, $2, $3, $4, false)", column_id, table_id, definition_id, position)
                .execute(&mut *transaction).await?;
        }
        for (index, (name, stage_index)) in blueprint.rows.iter().enumerate() {
            let row_id = macro_uuid::generate_uuid_v7();
            let position = format!("{:012}", index + 1);
            let cells = serde_json::to_value(std::collections::HashMap::from([
                (
                    title.definition.id.to_string(),
                    PropertyValue::Str((*name).into()),
                ),
                (
                    stage.definition.id.to_string(),
                    PropertyValue::SelectOption(vec![stage.property_options[*stage_index].id]),
                ),
            ]))?;
            sqlx::query!("INSERT INTO database_rows (id, table_id, position, cells, created_by) VALUES ($1, $2, $3, $4, $5)", row_id, table_id, position, cells, user_id)
                .execute(&mut *transaction).await?;
        }
        let mut board_id = None;
        for view in blueprint.views(user_id, stage_column_id) {
            if view.config["view"]["layout"] == "board" {
                board_id = Some(view.id);
            }
            self.views
                .create_view_in(&mut transaction, &view)
                .await
                .map_err(dependency)?;
        }
        entity_access_db_utils::insert_entity_access_row(
            &mut transaction,
            &database_id,
            EntityType::Database,
            user_id,
            EntityAccessSourceType::User,
            AccessLevel::Owner,
        )
        .await?;
        sqlx::query!(
            "UPDATE database_starter_seeds SET database_id = $2 WHERE user_id = $1",
            user_id,
            database_id
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(StarterDatabase {
            database_id: Some(database_id),
            table_id: Some(table_id),
            view_id: board_id,
            created: true,
        })
    }
}
