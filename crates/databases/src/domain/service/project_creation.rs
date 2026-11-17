//! Atomic creation in a folder, with sharing independent of that folder.

use super::*;
use crate::domain::ports::DatabasesProjectService;

impl<R, D, C, E, A, B> DatabasesServiceImpl<R, D, C, E, A, B>
where
    R: DatabasesRepo,
    D: ColumnDefinitionStore,
    C: CellStore,
    E: TableEventPublisher,
    A: AccessDirectory,
    B: MacroEventBroker,
{
    pub(super) async fn create_database_at(
        &self,
        command: CreateDatabase,
        project_id: Option<&str>,
    ) -> Result<Database, DatabaseError> {
        let first_table = FirstTable {
            name: validate_name(command.first_table.as_deref().unwrap_or(FIRST_TABLE_NAME))?,
            title_column: FIRST_TABLE_TITLE_COLUMN,
        };
        let command = CreateDatabase {
            name: validate_name(&command.name)?,
            ..command
        };
        let database = match project_id {
            Some(project_id) => {
                self.repository
                    .create_database_in_project(&command, first_table, project_id)
                    .await
            }
            None => self.repository.create_database(&command, first_table).await,
        }
        .map_err(repository_error)?;
        self.emit(DatabaseMacroEvent::created(DatabaseCreatedMetadata {
            database_id: database.id,
            owner: command.owner_id.clone(),
            name: database.name.clone(),
            created_at: database.created_at,
            attribution: events::Attribution::acting(command.owner_id, command.acting_bot),
        }));
        Ok(database)
    }
}

impl<R, D, C, E, A, B> DatabasesProjectService for DatabasesServiceImpl<R, D, C, E, A, B>
where
    R: DatabasesRepo,
    D: ColumnDefinitionStore,
    C: CellStore,
    E: TableEventPublisher,
    A: AccessDirectory,
    B: MacroEventBroker,
{
    #[tracing::instrument(skip(self, command, project), fields(project_id = %project.entity().entity_id, database_id = tracing::field::Empty), err)]
    async fn create_database_in_project(
        &self,
        command: CreateDatabase,
        project: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Database, DatabaseError> {
        if project.entity().entity_type != model_entity::EntityType::Project
            || project.acting_user_id() != Some(&command.owner_id)
            || Uuid::parse_str(&project.entity().entity_id).is_err()
        {
            return Err(DatabaseError::Unauthorized);
        }
        let database = self
            .create_database_at(command, Some(&project.entity().entity_id))
            .await?;
        tracing::Span::current().record("database_id", tracing::field::display(database.id));
        Ok(database)
    }
}
