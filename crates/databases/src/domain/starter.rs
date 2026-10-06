//! A small, retry-safe first database. Blueprint and provisioning policy live here.

use chrono::{DateTime, Utc};
use macro_event_broker::MacroEventBroker;
use models_databases::OptionId;
use models_databases::position::{Position, PositionError, keys_between};
use models_databases::views::{Lane, LaneKey, ViewLayout, ViewQuery};
use serde::Serialize;

use super::events::{Attribution, DatabaseCreatedMetadata, DatabaseMacroEvent};
use super::models::{ColumnId, DatabaseError, DatabaseId, DatabaseView, TableId, ViewId, Viewer};

/// Starter result. A missing database means the user already started or removed it.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StarterDatabase {
    /// Accessible starter database, if still present.
    #[schema(required = true, value_type = Option<String>)]
    pub database_id: Option<DatabaseId>,
    /// Initial table, returned only on first creation.
    #[schema(required = true, value_type = Option<String>)]
    pub table_id: Option<TableId>,
    /// Initial board view, returned only on first creation.
    #[schema(required = true, value_type = Option<String>)]
    pub view_id: Option<ViewId>,
    /// Whether this request created the example.
    pub created: bool,
}

/// Declarative content for one atomic creation attempt.
pub struct StarterBlueprint {
    /// New database identity (UUIDv7).
    pub database_id: DatabaseId,
    /// New table identity (UUIDv7).
    pub table_id: TableId,
    /// Name displayed in the workspace.
    pub name: &'static str,
    /// Name of the example table.
    pub table_name: &'static str,
    /// Title column label.
    pub title_name: &'static str,
    /// Board grouping column label.
    pub stage_name: &'static str,
    /// Initial category labels.
    pub stages: [&'static str; 3],
    /// Row title and stage index.
    pub rows: [(&'static str, usize); 3],
}

impl Default for StarterBlueprint {
    fn default() -> Self {
        Self {
            database_id: DatabaseId::new(),
            table_id: TableId::new(),
            name: "Getting started",
            table_name: "Ideas",
            title_name: "Name",
            stage_name: "Stage",
            stages: ["To do", "Doing", "Done"],
            rows: [
                ("Add your first idea", 0),
                ("Try moving a card", 1),
                ("Explore table and board views", 2),
            ],
        }
    }
}

impl StarterBlueprint {
    /// Two views of the same records: every column as a table, and a board
    /// of the ideas by stage, one lane per stage in order, each card titled
    /// by the idea.
    pub fn views(
        &self,
        title_column: ColumnId,
        stage_column: ColumnId,
        stage_options: &[OptionId],
        now: DateTime<Utc>,
    ) -> Result<[DatabaseView; 2], PositionError> {
        let [table_position, board_position] = keys_between(None, None, 2)?
            .try_into()
            .expect("two keys were asked for");
        let view = |name: &str, position: Position, layout: ViewLayout| DatabaseView {
            id: ViewId::new(),
            database_id: self.database_id,
            table_id: self.table_id,
            name: name.into(),
            position,
            query: ViewQuery::default(),
            layout,
            created_at: now,
            updated_at: now,
        };
        Ok([
            view(
                "Table",
                table_position,
                ViewLayout::Table {
                    columns: Vec::new(),
                },
            ),
            view(
                "Board",
                board_position,
                ViewLayout::Board {
                    group_by: stage_column,
                    title: title_column,
                    lanes: stage_options
                        .iter()
                        .map(|option| Lane {
                            key: LaneKey::Option(*option),
                            hidden: false,
                        })
                        .collect(),
                    card_fields: Vec::new(),
                    hide_empty_lanes: false,
                },
            ),
        ])
    }
}

/// Persistence owns the atomic insert and unique per-user marker.
pub trait DatabaseStarterRepo: Send + Sync + 'static {
    /// Persistence error.
    type Error: std::error::Error + Send + Sync + 'static;
    /// Create only once and only for someone without an existing database.
    /// Never overwrite, recreate deleted content, or expose a partial example.
    fn ensure_starter(
        &self,
        viewer: &Viewer,
        blueprint: &StarterBlueprint,
    ) -> impl Future<Output = Result<StarterDatabase, Self::Error>> + Send;
}

/// Authenticated-user provisioning capability. No caller-supplied owner or content.
pub trait DatabaseStarterService: Send + Sync + 'static {
    /// Ensure the acting user's small starter database exists once.
    fn ensure_starter(
        &self,
        viewer: Viewer,
    ) -> impl Future<Output = Result<StarterDatabase, DatabaseError>> + Send;
}

/// Composes a starter blueprint with atomic storage and standard creation events.
pub struct DatabaseStarterServiceImpl<Repository, Broker> {
    repository: Repository,
    broker: Broker,
}

impl<Repository, Broker> DatabaseStarterServiceImpl<Repository, Broker> {
    /// Construct from domain capabilities at the composition root.
    pub fn new(repository: Repository, broker: Broker) -> Self {
        Self { repository, broker }
    }
}

impl<Repository: DatabaseStarterRepo, Broker: MacroEventBroker> DatabaseStarterService
    for DatabaseStarterServiceImpl<Repository, Broker>
{
    async fn ensure_starter(&self, viewer: Viewer) -> Result<StarterDatabase, DatabaseError> {
        let blueprint = StarterBlueprint::default();
        let outcome = self
            .repository
            .ensure_starter(&viewer, &blueprint)
            .await
            .map_err(|error| DatabaseError::Repo(rootcause::Report::new(error).into_dynamic()))?;
        if outcome.created {
            let event = DatabaseMacroEvent::created(DatabaseCreatedMetadata {
                database_id: blueprint.database_id,
                owner: viewer.user_id.clone(),
                name: blueprint.name.into(),
                created_at: Utc::now(),
                attribution: Attribution::acting(viewer.user_id, viewer.acting_bot),
            });
            if let Err(error) = self.broker.send_event(&event) {
                tracing::warn!(?error, "failed to publish starter database creation");
            }
        }
        Ok(outcome)
    }
}
