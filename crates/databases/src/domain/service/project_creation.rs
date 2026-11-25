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
        id: Option<DatabaseId>,
    ) -> Result<Database, DatabaseError> {
        let first_table = FirstTable {
            ids: id.map(crate::domain::models::FirstTableIds::for_database),
            name: validate_name(command.first_table.as_deref().unwrap_or(FIRST_TABLE_NAME))?,
            title_column: FIRST_TABLE_TITLE_COLUMN,
        };
        let command = CreateDatabase {
            name: validate_name(&command.name)?,
            ..command
        };
        // The ledger reserves this id before creation. A replay, including one
        // racing the original create, may reuse only this owner's same filing.
        if let Some(id) = id
            && let Some((database, _)) = self
                .repository
                .get_database(id)
                .await
                .map_err(repository_error)?
        {
            return reusable_database(database, &command, project_id);
        }
        let created = match project_id {
            Some(project_id) => {
                self.repository
                    .create_database_in_project(
                        id.ok_or(DatabaseError::Unauthorized)?,
                        &command,
                        first_table,
                        project_id,
                    )
                    .await
            }
            None => {
                self.repository
                    .create_database(id.unwrap_or_default(), &command, first_table)
                    .await
            }
        }
        .map_err(repository_error);
        let database = match created {
            Ok(database) => database,
            Err(error) => {
                if let Some(id) = id
                    && let Some((database, _)) = self
                        .repository
                        .get_database(id)
                        .await
                        .map_err(repository_error)?
                {
                    return reusable_database(database, &command, project_id);
                }
                return Err(error);
            }
        };
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
    #[tracing::instrument(skip(self, command), fields(database_id = %id), err)]
    async fn create_database_with_id(
        &self,
        id: DatabaseId,
        command: CreateDatabase,
    ) -> Result<Database, DatabaseError> {
        self.create_database_at(command, None, Some(id)).await
    }

    #[tracing::instrument(skip(self, command, project), fields(project_id = %project.entity().entity_id, database_id = tracing::field::Empty), err)]
    async fn create_database_in_project(
        &self,
        id: DatabaseId,
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
            .create_database_at(command, Some(&project.entity().entity_id), Some(id))
            .await?;
        tracing::Span::current().record("database_id", tracing::field::display(database.id));
        Ok(database)
    }
}

/// A replay cannot transfer ownership, revive trash, or change filing.
fn reusable_database(
    database: Database,
    command: &CreateDatabase,
    project: Option<&str>,
) -> Result<Database, DatabaseError> {
    if database.owner_id != command.owner_id.as_ref()
        || database.project_id.as_deref() != project
        || database.trashed_at.is_some()
    {
        return Err(DatabaseError::Unauthorized);
    }
    Ok(database)
}
