//! QueryDatabase tool: the read *and* write verb for Macro Databases. What
//! it may write is the viewer's access, never the tool.

use models_databases::{DatabaseId, RowId, TableId};
use std::collections::HashMap;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use contacts::domain::ports::ContactsService;
use databases::domain::models::TableVersion;
use databases::domain::ports::DatabasesService;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use soup::domain::ports::SoupService;

use super::{DatabasesSqlToolContext, sql_error};
use crate::outcome::{ResultSet, SqlOutcome, SqlStatement};
use crate::service::SqlRequest;

/// Run SQL against the user's databases.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "QueryDatabase",
    description = concat!(
        include_str!("query_database.md"),
        include_str!("sql_guide.md"),
        include_str!("query_database_writes.md"),
    )
)]
pub struct QueryDatabase {
    /// The statement to run.
    #[schemars(
        description = "The statement to run, as one string. Use the table and column names \
                       DescribeDatabase reported, quoted when they have spaces."
    )]
    pub sql: String,
    /// The database the statement is about, when known. Its tables win over
    /// same-named tables of other databases, so a name collision such as two
    /// databases each holding a "Table 1" never has to be qualified away.
    #[schemars(
        description = "Id of the database the statement is about, from ListDatabases or \
                       DescribeDatabase. Pass it whenever you know it: this database's tables \
                       take precedence when another database has a table of the same name. \
                       Tables of other databases stay reachable for joins."
    )]
    #[serde(default)]
    pub database_id: Option<DatabaseId>,
    /// Optional versions from a previous QueryDatabase read. Reject the write
    /// if a listed table being written changed. Read-only dependencies are not
    /// guarded; omit for a read or intentional blind edit.
    #[serde(default)]
    pub base_versions: Option<Vec<ToolTableVersion>>,
    /// Preferred native result presentation. For an explicit chart request,
    /// select bar, line, area, scatter or pie and return a label column plus
    /// numeric values. The app falls back to a table if the data cannot
    /// support that display.
    #[serde(default)]
    pub display: Option<QueryDatabaseDisplay>,
}

/// Presentation hint for a query result; it does not affect SQL execution.
#[derive(Debug, Deserialize, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QueryDatabaseDisplay {
    /// Show the returned rows and columns.
    Table,
    /// Show one numeric value.
    Scalar,
    /// Compare categories with a bar chart.
    Bar,
    /// Show an ordered trend with a line chart.
    Line,
    /// Show an ordered trend as a filled area, stacked by series.
    Area,
    /// Plot one numeric column against another.
    Scatter,
    /// Show category proportions with a pie chart.
    Pie,
}

/// Version of one table actually read by a query.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTableVersion {
    /// Stable table id, not a SQL name.
    pub table_id: TableId,
    /// Version acknowledged by the read.
    pub version: i64,
}

impl ToolAnnotated for QueryDatabase {
    // Not read-only: the same tool is the write path. Not idempotent either —
    // re-running an INSERT inserts again.
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Query database");
}

/// Response from the QueryDatabase tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueryDatabaseResponse {
    /// The SELECT's result set; empty for a write.
    pub results: Vec<ResultSet>,
    /// How many rows the statement changed.
    pub changes_applied: usize,
    /// Ids the server minted for inserted rows, in insertion order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inserted_row_ids: Vec<RowId>,
    /// New version of every table written, keyed by table id.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub new_versions: HashMap<TableId, i64>,
    /// Versions of the tables this query actually read. Supply these as
    /// baseVersions to guard tables a later edit writes. Tables it only reads
    /// are not guarded.
    pub read_versions: Vec<ToolTableVersion>,
    /// Every table the query read, when a read hit the row cap: the cap is
    /// reported per statement, so any aggregate over these tables may be
    /// computed on a partial table — say so rather than reporting it as a
    /// total.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub truncated_tables: Vec<String>,
    /// What kind of statement ran, and the table (and column) it wrote.
    pub statement: SqlStatement,
    /// A human-readable summary of what the statement did.
    pub summary: String,
}

#[async_trait]
impl<Databases, Access, Soup, Contacts>
    AsyncTool<DatabasesSqlToolContext<Databases, Access, Soup, Contacts>> for QueryDatabase
where
    Databases: DatabasesService,
    Access: EntityAccessService,
    Soup: SoupService,
    Contacts: ContactsService,
{
    type Output = QueryDatabaseResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesSqlToolContext<Databases, Access, Soup, Contacts>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        // No receipt here, and that is the design: the catalog built for this
        // viewer *is* the authorization for reads, and each write mints its
        // own edit receipt for the database it lands in.
        let outcome = service_context
            .sql
            .execute(
                service_context.viewer(&request_context.user_id),
                SqlRequest {
                    sql: self.sql.clone(),
                    scope: self.database_id,
                    base_versions: self
                        .base_versions
                        .iter()
                        .flatten()
                        .map(|entry| (entry.table_id, TableVersion(entry.version)))
                        .collect(),
                },
            )
            .await
            .map_err(sql_error)?;

        Ok(outcome.into())
    }
}

impl From<SqlOutcome> for QueryDatabaseResponse {
    fn from(outcome: SqlOutcome) -> Self {
        let results: Vec<ResultSet> = outcome.result.into_iter().collect();
        let summary = match &outcome.statement {
            SqlStatement::Schema { summary, .. } => summary.clone(),
            SqlStatement::AlterColumnType {
                column_name, to, ..
            } => format!("Changed \"{column_name}\" to {to}."),
            SqlStatement::Select
            | SqlStatement::Insert { .. }
            | SqlStatement::Update { .. }
            | SqlStatement::Delete { .. } => {
                summarize(&results, outcome.changes_applied, &outcome.truncated_tables)
            }
        };
        let mut read_versions: Vec<_> = outcome
            .read_versions
            .into_iter()
            .map(|(table_id, version)| ToolTableVersion {
                table_id,
                version: version.0,
            })
            .collect();
        read_versions.sort_by_key(|entry| entry.table_id);

        Self {
            results,
            changes_applied: outcome.changes_applied,
            inserted_row_ids: outcome.inserted_row_ids,
            truncated_tables: outcome.truncated_tables,
            new_versions: outcome
                .new_versions
                .into_iter()
                .map(|(table_id, version)| (table_id, version.0))
                .collect(),
            statement: outcome.statement,
            summary,
            read_versions,
        }
    }
}

/// Say what happened, so a model does not have to infer "it worked" from an
/// empty result set — which reads identically to "nothing matched".
fn summarize(results: &[ResultSet], changes_applied: usize, truncated_tables: &[String]) -> String {
    let rows: usize = results.iter().map(|result| result.rows.len()).sum();
    let mut parts = Vec::new();

    if !results.is_empty() {
        parts.push(match rows {
            0 => "No rows matched.".to_string(),
            1 => "Returned 1 row.".to_string(),
            count => format!("Returned {count} rows."),
        });
    }
    if changes_applied > 0 {
        let plural = if changes_applied == 1 { "" } else { "s" };
        parts.push(format!("Applied {changes_applied} row change{plural}."));
    }
    if !truncated_tables.is_empty() {
        // A capped table looks exactly like a complete one in the result set,
        // and a model that cannot tell will report a partial COUNT as a total.
        parts.push(format!(
            "A read hit the row cap, so these tables may be incomplete: {}. Narrow the query \
             rather than treating any aggregate over them as a total.",
            truncated_tables.join(", ")
        ));
    }
    if parts.is_empty() {
        return "The statement ran and changed nothing.".to_string();
    }
    parts.join(" ")
}
