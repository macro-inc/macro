//! A small, retry-safe first database. Blueprint and provisioning policy live here.

use chrono::Utc;
use macro_event_broker::MacroEventBroker;
use serde::Serialize;
use uuid::Uuid;

use super::events::{DatabaseCreatedMetadata, DatabaseMacroEvent};
use super::models::{DatabaseError, DatabaseId, TableId, Viewer};

/// Starter result. A missing database means the user already started or removed it.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StarterDatabase {
    /// Accessible starter database, if still present.
    #[schema(value_type = Option<String>)]
    pub database_id: Option<DatabaseId>,
    /// Initial table, returned only on first creation.
    #[schema(value_type = Option<String>)]
    pub table_id: Option<TableId>,
    /// Initial board view, returned only on first creation.
    #[schema(value_type = Option<String>)]
    pub view_id: Option<Uuid>,
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
            database_id: macro_uuid::generate_uuid_v7(),
            table_id: macro_uuid::generate_uuid_v7(),
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
    /// Native personal views of the same records, without copying data.
    pub fn views(&self, user_id: &str, stage_column_id: Uuid) -> Vec<saved_views::View> {
        [("Table", "table"), ("Board", "board")].into_iter().map(|(name, layout)| {
            saved_views::View::new(user_id.into(), name.into(), serde_json::json!({
                "kind": "database-view", "version": 1, "databaseId": self.database_id, "tableId": self.table_id,
                "view": { "layout": layout, "groupBy": if layout == "board" { Some(stage_column_id) } else { None },
                    "filters": [], "sorts": [], "hiddenColumns": [], "search": "" }
            }))
        }).collect()
    }
}

/// Persistence owns the atomic insert and unique per-user marker.
pub trait DatabaseStarterRepo: Send + Sync + 'static {
    /// Persistence error.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Create only once and only for someone without an existing database.
    /// Never overwrite, recreate deleted content, or expose a partial example.
    fn ensure_starter(
        &self,
        viewer: &Viewer,
        blueprint: &StarterBlueprint,
    ) -> impl Future<Output = Result<StarterDatabase, Self::Err>> + Send;
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
pub struct DatabaseStarterServiceImpl<Repo, Broker> {
    repo: Repo,
    broker: Broker,
}

impl<Repo, Broker> DatabaseStarterServiceImpl<Repo, Broker> {
    /// Construct from domain capabilities at the composition root.
    pub fn new(repo: Repo, broker: Broker) -> Self {
        Self { repo, broker }
    }
}

impl<Repo: DatabaseStarterRepo, Broker: MacroEventBroker> DatabaseStarterService
    for DatabaseStarterServiceImpl<Repo, Broker>
{
    async fn ensure_starter(&self, viewer: Viewer) -> Result<StarterDatabase, DatabaseError> {
        let blueprint = StarterBlueprint::default();
        let outcome = self
            .repo
            .ensure_starter(&viewer, &blueprint)
            .await
            .map_err(|error| DatabaseError::Repo(rootcause::Report::new(error).into_dynamic()))?;
        if outcome.created {
            let event = DatabaseMacroEvent::created(DatabaseCreatedMetadata {
                database_id: blueprint.database_id.to_string(),
                owner: viewer.user_id,
                name: blueprint.name.into(),
                created_at: Utc::now(),
            });
            if let Err(error) = self.broker.send_event(&event) {
                tracing::warn!(?error, "failed to publish starter database creation");
            }
        }
        Ok(outcome)
    }
}
