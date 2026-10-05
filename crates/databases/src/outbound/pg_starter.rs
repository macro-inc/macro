//! Starter provisioning: the database, its schema, rows, cells and views
//! commit together, so a retry never finds half an example.

#[cfg(test)]
mod test;
use models_databases::position::{PositionError, keys_between};
use models_databases::{ColumnId, DatabaseId, OptionId, RowId};
use models_properties::DataType;
use models_properties::EntityReference;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use properties::domain::database_cell_writer::DatabaseCellWriter;
use properties::domain::database_definition_writer::{
    DatabaseDefinitionWriter, NewDatabaseDefinition,
};
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::journal::{JournalActor, created_table};
use crate::domain::models::Viewer;
use crate::domain::starter::{DatabaseStarterRepo, StarterBlueprint, StarterDatabase};
use crate::outbound::pg_databases_repo::{
    PgDatabasesRepoError, insert_column, insert_owned_database, journal, rows, views,
};

/// Starter seeding errors; any of them rolls the whole seed back.
#[derive(Debug, thiserror::Error)]
pub enum PgStarterError {
    /// A statement of the seed failed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// The properties writer failed.
    #[error("starter dependency failed: {0}")]
    Dependency(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// A repository statement of the seed failed.
    #[error("starter statement failed: {0}")]
    Repository(#[from] PgDatabasesRepoError),
    /// The seed's positions could not be minted.
    #[error("starter positions failed: {0}")]
    Position(#[from] PositionError),
    /// A seed row names a stage the blueprint does not have.
    #[error("starter row names stage {0}, which the blueprint does not have")]
    MissingStage(usize),
}

/// [`DatabaseStarterRepo`] over Postgres and the properties writers.
pub struct PgDatabaseStarterRepo<Properties> {
    pool: PgPool,
    properties: Properties,
}

impl<Properties> PgDatabaseStarterRepo<Properties> {
    /// Wrap the pool and the properties writers.
    pub fn new(pool: PgPool, properties: Properties) -> Self {
        Self { pool, properties }
    }
}

fn dependency(error: impl std::error::Error + Send + Sync + 'static) -> PgStarterError {
    PgStarterError::Dependency(Box::new(error))
}

impl<Properties> DatabaseStarterRepo for PgDatabaseStarterRepo<Properties>
where
    Properties: DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>
        + DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>
        + Send
        + Sync
        + 'static,
{
    type Error = PgStarterError;

    #[tracing::instrument(err, skip(self, viewer, blueprint))]
    async fn ensure_starter(
        &self,
        viewer: &Viewer,
        blueprint: &StarterBlueprint,
    ) -> Result<StarterDatabase, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        let user_id = viewer.user_id.as_ref();
        let claimed = sqlx::query_scalar!(
            "INSERT INTO database_starter_seeds (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id",
            user_id,
        )
        .fetch_optional(&mut *transaction)
        .await?
        .is_some();
        if !claimed {
            let database_id = sqlx::query_scalar!(
                r#"SELECT d.id FROM database_starter_seeds s JOIN databases d ON d.id = s.database_id
                   WHERE s.user_id = $1 AND d.trashed_at IS NULL"#,
                user_id,
            )
            .fetch_optional(&mut *transaction)
            .await?;
            return Ok(StarterDatabase {
                database_id: database_id.map(DatabaseId::from_uuid),
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
        insert_owned_database(
            &mut transaction,
            database_id,
            blueprint.name,
            user_id,
            table_id,
            blueprint.table_name,
        )
        .await?;
        let title = self
            .properties
            .create_database_definition_in(
                &mut transaction,
                NewDatabaseDefinition {
                    id: macro_uuid::generate_uuid_v7(),
                    database_id: database_id.into_uuid(),
                    name: blueprint.title_name,
                    data_type: DataType::String,
                    is_multi_select: false,
                    specific_entity_type: None,
                    options: &[],
                },
            )
            .await
            .map_err(dependency)?;
        let stage_options: Vec<(uuid::Uuid, PropertyOptionValue)> = blueprint
            .stages
            .iter()
            .map(|stage| {
                (
                    OptionId::new().into_uuid(),
                    PropertyOptionValue::String((*stage).to_string()),
                )
            })
            .collect();
        let stage = self
            .properties
            .create_database_definition_in(
                &mut transaction,
                NewDatabaseDefinition {
                    id: macro_uuid::generate_uuid_v7(),
                    database_id: database_id.into_uuid(),
                    name: blueprint.stage_name,
                    data_type: DataType::SelectString,
                    is_multi_select: false,
                    specific_entity_type: None,
                    options: &stage_options,
                },
            )
            .await
            .map_err(dependency)?;
        let title_column_id = ColumnId::new();
        let stage_column_id = ColumnId::new();
        let column_positions = keys_between(None, None, 2)?;
        for ((column_id, definition_id), position) in [
            (title_column_id, title.definition.id),
            (stage_column_id, stage.definition.id),
        ]
        .into_iter()
        .zip(column_positions)
        {
            insert_column(
                &mut transaction,
                column_id,
                table_id,
                definition_id,
                &position,
                false,
            )
            .await?;
        }
        let version = rows::bump_table_version(&mut *transaction, table_id)
            .await
            .map_err(PgDatabasesRepoError::from)?;
        let mut seeded = Vec::with_capacity(blueprint.rows.len());
        let positions = keys_between(None, None, blueprint.rows.len())?;
        for ((name, stage_index), position) in blueprint.rows.iter().zip(positions) {
            let stage_option = stage
                .property_options
                .get(*stage_index)
                .ok_or(PgStarterError::MissingStage(*stage_index))?;
            let row_id = RowId::new();
            seeded.push(row_id);
            sqlx::query!(
                "INSERT INTO database_rows (id, table_id, position, created_by) VALUES ($1, $2, $3, $4)",
                row_id.into_uuid(),
                table_id.into_uuid(),
                position.as_str(),
                user_id,
            )
            .execute(&mut *transaction)
            .await?;
            let row = EntityReference {
                entity_id: row_id.to_string(),
                entity_type: models_properties::EntityType::DatabaseRow,
                specific_message_id: None,
            };
            for (definition_id, value) in [
                (title.definition.id, PropertyValue::Str((*name).into())),
                (
                    stage.definition.id,
                    PropertyValue::SelectOption(vec![stage_option.id]),
                ),
            ] {
                self.properties
                    .upsert_entity_property_in(&mut transaction, &row, definition_id, Some(value))
                    .await
                    .map_err(dependency)?;
            }
        }
        let stage_options: Vec<_> = stage
            .property_options
            .iter()
            .map(|option| OptionId::from_uuid(option.id))
            .collect();
        let [table_view, board] = blueprint.views(
            title_column_id,
            stage_column_id,
            &stage_options,
            models_databases::views::written_at(),
        )?;
        views::insert_view(&mut *transaction, &table_view).await?;
        views::insert_view(&mut *transaction, &board).await?;
        journal::record(
            &mut transaction,
            &JournalActor {
                user: Some(user_id.to_string()),
                acting_bot: None,
            },
            &[created_table(
                database_id,
                table_id,
                version,
                &[title_column_id, stage_column_id],
                &seeded,
            )],
        )
        .await?;
        sqlx::query!(
            "UPDATE database_starter_seeds SET database_id = $2 WHERE user_id = $1",
            user_id,
            database_id.into_uuid()
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(StarterDatabase {
            database_id: Some(database_id),
            table_id: Some(table_id),
            view_id: Some(board.id),
            created: true,
        })
    }
}
