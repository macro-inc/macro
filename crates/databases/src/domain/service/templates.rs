//! Databases built by a template, the starter among them: a new database and
//! its template's ops batch, committed together.

use chrono::SubsecRound;
use models_databases::views::ViewLayout;
use models_databases::{OpResult, TableResult, ViewResult};

use super::*;
use crate::domain::models::{AppliedOps, NewDatabase};
use crate::domain::starter::{DatabaseStarterService, StarterDatabase};
use crate::domain::templates::{TemplateContext, TemplateId};

impl<Repository, Definitions, Cells, Events, Access, Broker>
    DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    /// Create a database named `name`, owned by the viewer, and build it with
    /// the template's ops, all or nothing. `None` when it is a starter the
    /// viewer was given already.
    pub(super) async fn create_from_template(
        &self,
        viewer: &Viewer,
        name: String,
        template: TemplateId,
        starter: bool,
    ) -> Result<Option<(Database, AppliedOps)>, DatabaseError> {
        // Stored to the microsecond, so the answer matches what reads return.
        let now = Utc::now().trunc_subsecs(6);
        let new = NewDatabase {
            database: Database {
                id: DatabaseId::new(),
                name,
                owner_id: viewer.user_id.to_string(),
                created_at: now,
                trashed_at: None,
            },
            starter,
        };
        let ops = template.ops(&TemplateContext::new(new.database.id, now));
        let applied = self.create_with_ops(&new, viewer, &ops.into()).await?;
        Ok(applied.map(|applied| (new.database, applied)))
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabaseStarterService
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self), err)]
    async fn ensure_starter(&self, viewer: Viewer) -> Result<StarterDatabase, DatabaseError> {
        let template = TemplateId::GettingStarted.template();
        let created = self
            .create_from_template(&viewer, template.name.into(), template.id, true)
            .await?;
        let Some((database, applied)) = created else {
            return Ok(StarterDatabase {
                database_id: self
                    .repository
                    .starter_database(&viewer.user_id)
                    .await
                    .map_err(repository_error)?,
                table_id: None,
                view_id: None,
                created: false,
            });
        };
        Ok(StarterDatabase {
            database_id: Some(database.id),
            table_id: applied.results.iter().find_map(|result| match result {
                OpResult::Table {
                    table,
                    change: TableResult::Created,
                    ..
                } => Some(*table),
                _ => None,
            }),
            view_id: applied.results.iter().find_map(|result| match result {
                OpResult::View {
                    view,
                    change: ViewResult::Created { view: stored },
                    ..
                } if matches!(stored.layout, ViewLayout::Board { .. }) => Some(*view),
                _ => None,
            }),
            created: true,
        })
    }
}
