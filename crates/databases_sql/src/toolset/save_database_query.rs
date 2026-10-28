//! SaveDatabaseQuery tool: save a question and hand back the live block that
//! renders its answer wherever it is pasted.

use models_databases::{DatabaseId, QueryId};
use std::collections::HashSet;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use contacts::domain::ports::ContactsService;
use databases::domain::models::QueryDefinition;
use databases::domain::ports::DatabasesService;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use soup::domain::ports::SoupService;

use super::{DatabasesSqlToolContext, QueryDatabaseDisplay, sql_error};
use crate::service::ChartColumns;

/// Most series one chart plots, matching what the document node accepts.
const MAX_CHART_SERIES: usize = 5;

/// Save a question as a live query block.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "SaveDatabaseQuery",
    description = include_str!("save_database_query.md")
)]
pub struct SaveDatabaseQuery {
    /// The database the question is about.
    #[schemars(
        description = "Id of the database the question is about, from ListDatabases. Its \
                       tables win when another database has a table of the same name."
    )]
    #[serde(default)]
    pub database_id: Option<DatabaseId>,
    /// The SELECT to save.
    #[schemars(description = "The SELECT to save, exactly as it ran with QueryDatabase.")]
    pub sql: String,
    /// Heading shown above the answer.
    #[schemars(description = "Short heading shown with the answer, e.g. \"Invites per party\".")]
    pub title: String,
    /// How the answer is shown.
    pub display_mode: QueryDatabaseDisplay,
    /// Chart configuration for bar, line, area, scatter and pie.
    #[serde(default)]
    pub chart: Option<ToolChart>,
    /// The question in the user's words.
    #[schemars(
        description = "The question as the user asked it. Defaults to the title; shown when \
                       someone edits the question."
    )]
    #[serde(default)]
    pub prompt: Option<String>,
}

/// Which result columns a chart plots.
#[derive(Debug, Deserialize, Serialize, JsonSchema, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolChart {
    /// The label column.
    #[schemars(description = "Result column holding the labels (the x axis or pie slices).")]
    pub x: String,
    /// The value columns.
    #[schemars(description = "One to five numeric result columns to plot, none equal to x.")]
    pub y: Vec<String>,
    /// Chart heading.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The column whose values split the series.
    #[schemars(
        description = "Result column whose values split the one y series into a series per \
                       value. Neither x nor in y."
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Whether series stack.
    #[schemars(description = "Stack bar or area series instead of setting them side by side.")]
    // The node writes `stack` only when it is set.
    #[serde(default, skip_serializing_if = "unstacked")]
    pub stack: Option<bool>,
}

fn unstacked(stack: &Option<bool>) -> bool {
    *stack != Some(true)
}

impl ToolAnnotated for SaveDatabaseQuery {
    // It stores a question, never data, and every save is a new row.
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Save database query");
}

/// Response from the SaveDatabaseQuery tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveDatabaseQueryResponse {
    /// The saved question's id.
    pub query_id: QueryId,
    /// The block to paste verbatim where the answer should appear.
    pub markdown: String,
}

/// The document node's payload, in the key order the node writes it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryBlock<'a> {
    query_id: QueryId,
    #[serde(skip_serializing_if = "Option::is_none")]
    database_id: Option<DatabaseId>,
    title: &'a str,
    prompt: &'a str,
    display_mode: QueryDatabaseDisplay,
    #[serde(skip_serializing_if = "Option::is_none")]
    chart: Option<&'a ToolChart>,
}

/// The block's markdown: compact JSON between the node's tags.
fn query_block_markdown(
    query_id: QueryId,
    database_id: Option<DatabaseId>,
    title: &str,
    prompt: &str,
    display_mode: QueryDatabaseDisplay,
    chart: Option<&ToolChart>,
) -> String {
    let json = serde_json::to_string(&QueryBlock {
        query_id,
        database_id,
        title,
        prompt,
        display_mode,
        chart,
    })
    .expect("a query block always serializes");
    // `<` only occurs inside strings; escaping it keeps a title such as
    // "</m-db-query>" from closing the tag early.
    format!("<m-db-query>{}</m-db-query>", json.replace('<', "\\u003c"))
}

fn invalid(description: impl Into<String>) -> ToolCallError {
    let description = description.into();
    ToolCallError {
        internal_error: anyhow::anyhow!(description.clone()),
        description,
    }
}

fn validate_chart(chart: &ToolChart) -> Result<(), ToolCallError> {
    if chart.x.trim().is_empty() {
        return Err(invalid(
            "chart.x must name the result column holding the labels.",
        ));
    }
    if chart.y.is_empty() || chart.y.len() > MAX_CHART_SERIES {
        return Err(invalid(format!(
            "chart.y must name one to {MAX_CHART_SERIES} numeric result columns."
        )));
    }
    if chart.y.iter().any(|name| name.trim().is_empty()) {
        return Err(invalid("chart.y must not contain an empty column name."));
    }
    if chart.y.iter().collect::<HashSet<_>>().len() != chart.y.len() {
        return Err(invalid("chart.y must not name a column twice."));
    }
    if chart.y.contains(&chart.x) {
        return Err(invalid(
            "chart.y must not include the label column chart.x.",
        ));
    }
    if let Some(color) = &chart.color {
        if color.trim().is_empty() {
            return Err(invalid("chart.color must name a result column."));
        }
        if *color == chart.x {
            return Err(invalid("chart.color must not be the label column chart.x."));
        }
        if chart.y.contains(color) {
            return Err(invalid(
                "chart.color must not be one of the chart.y columns.",
            ));
        }
        if chart.y.len() > 1 {
            return Err(invalid(
                "chart.color splits a single series; with chart.color, chart.y names one column.",
            ));
        }
    }
    Ok(())
}

#[async_trait]
impl<Databases, Access, Soup, Contacts>
    AsyncTool<DatabasesSqlToolContext<Databases, Access, Soup, Contacts>> for SaveDatabaseQuery
where
    Databases: DatabasesService,
    Access: EntityAccessService,
    Soup: SoupService,
    Contacts: ContactsService,
{
    type Output = SaveDatabaseQueryResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = ?self.database_id,
        display_mode = ?self.display_mode,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesSqlToolContext<Databases, Access, Soup, Contacts>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let title = self.title.trim();
        if title.is_empty() {
            return Err(invalid("title must not be empty."));
        }
        if let Some(chart) = &self.chart {
            validate_chart(chart)?;
        }
        let prompt = self
            .prompt
            .as_deref()
            .map(str::trim)
            .filter(|prompt| !prompt.is_empty())
            .unwrap_or(title);

        let saved = service_context
            .sql
            .save_query(
                service_context.viewer(&request_context.user_id),
                self.database_id,
                QueryDefinition::V1 {
                    query: self.sql.clone(),
                },
                self.chart.as_ref().map(|chart| ChartColumns {
                    x: &chart.x,
                    y: &chart.y,
                    color: chart.color.as_deref(),
                }),
            )
            .await
            .map_err(sql_error)?;

        Ok(SaveDatabaseQueryResponse {
            query_id: saved.id,
            markdown: query_block_markdown(
                saved.id,
                saved.database_id,
                title,
                prompt,
                self.display_mode,
                self.chart.as_ref(),
            ),
        })
    }
}
