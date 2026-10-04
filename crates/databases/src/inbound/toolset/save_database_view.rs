//! SaveDatabaseView: create or replace a typed view of a table through the
//! view ops.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::views::{
    Conjunction, DatabaseView, FilterCondition, FilterGroup, FilterNode, NewView, RequestedLayout,
    SortKey, ViewId, ViewQuery,
};
use models_databases::{DatabaseId, TableId};
use models_databases::{DatabaseOp, OpResult, ViewChange, ViewResult};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{DatabasesToolContext, table_of};
use crate::domain::models::OpBatch;
use crate::domain::ports::DatabasesService;

/// Save a named view of an existing table.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "SaveDatabaseView",
    description = "\
Save a table or kanban board view of one table of a Macro database. Views are shared with \
everyone who can open the database, so saving one needs edit access. Call DescribeDatabase \
first: a view names columns and select options by their ids, never by name. The filter's \
conditions combine with one `and` or `or`, each test fitting its column's type (text, \
number, date, checkbox, options, entities, or presence for any column); sort keys order the \
rows. A board groups its cards into lanes by a single-select or single-person column: one \
lane per option, or per person its cards name, plus one for cards with an empty cell; no \
other column type can group a board. A lane's `key` has a `kind`: `option` with the \
option's `id`, `user` with the person's user `id`, or `none`. A card's title is a column, \
the board's `title`, the first by default. Saving under a name the table already has \
replaces that view, so read `created` in the result; DeleteDatabaseView removes a view. \
Views change presentation, never records, and cannot save charts or SQL."
)]
pub struct SaveDatabaseView {
    /// Database id from ListDatabases.
    pub database_id: DatabaseId,
    /// Table id from DescribeDatabase.
    pub table_id: TableId,
    /// Name shown in the table's view tabs.
    pub name: String,
    /// Which rows the view shows; every row when left out.
    #[serde(default)]
    pub filter: Option<ToolFilter>,
    /// The sort keys, first key first; the table's own order when empty.
    #[serde(default)]
    pub sort: Vec<SortKey>,
    /// How it draws them: a table, or a board. A board's `title` is the
    /// column its cards are titled by; left out, a board keeps its title,
    /// and a new one is titled by the table's first column.
    pub layout: RequestedLayout,
}

/// Conditions joined by one conjunction. Views saved here filter on one
/// level; the app can nest groups.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolFilter {
    /// Whether every condition must hold (`and`), or any one (`or`).
    pub conjunction: Conjunction,
    /// The conditions.
    pub conditions: Vec<FilterCondition>,
}

impl SaveDatabaseView {
    fn query(&self) -> ViewQuery {
        ViewQuery {
            filter: self.filter.as_ref().map(|filter| FilterGroup {
                conjunction: filter.conjunction,
                conditions: filter
                    .conditions
                    .iter()
                    .cloned()
                    .map(FilterNode::Condition)
                    .collect(),
            }),
            sort: self.sort.clone(),
        }
    }
}

/// The view as saved.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedDatabaseView {
    /// The view, with its id.
    // Opaque: the filter tree is recursive, which the web's tool-type generator cannot follow.
    #[schemars(with = "serde_json::Value")]
    pub view: DatabaseView,
    /// Whether this created the view; `false` when it replaced the one of
    /// the same name.
    pub created: bool,
}

impl ToolAnnotated for SaveDatabaseView {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Save database view");
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>>
    for SaveDatabaseView
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = SavedDatabaseView;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id, database_id = %self.database_id, table_id = %self.table_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<Service, EntityAccess>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_id = &request_context.user_id;
        let schema = service_context
            .current_schema(user_id, self.database_id)
            .await?;
        let existing = table_of(&schema, self.table_id)?
            .view_named(&self.name)
            .map(|view| view.id);
        let op = match existing {
            Some(view) => DatabaseOp::View {
                table: self.table_id,
                view,
                change: ViewChange::Update {
                    name: Some(self.name.clone()),
                    query: Some(self.query()),
                    layout: Some(self.layout.clone()),
                },
            },
            None => DatabaseOp::View {
                table: self.table_id,
                view: ViewId::new(),
                change: ViewChange::Create {
                    view: NewView {
                        name: self.name.clone(),
                        query: self.query(),
                        layout: self.layout.clone(),
                    },
                },
            },
        };
        let results = service_context
            .apply(user_id, self.database_id, OpBatch::from(vec![op]))
            .await?;
        match results.into_iter().next() {
            Some(OpResult::View {
                change: ViewResult::Created { view } | ViewResult::Updated { view },
                ..
            }) => Ok(SavedDatabaseView {
                view: *view,
                created: existing.is_none(),
            }),
            other => Err(ToolCallError {
                description: "The view was not saved.".into(),
                internal_error: anyhow::anyhow!("a view op answered {other:?}"),
            }),
        }
    }
}
