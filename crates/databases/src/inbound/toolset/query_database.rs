//! QueryDatabase tool: the read *and* write verb for Macro Databases.

use std::collections::HashMap;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DatabasesToolContext, magic_tables_note, query_error, sql_guide, viewer_of};
use crate::domain::models::{ExecRequest, QueryResult, SqlValue};
use crate::domain::ports::DatabasesService;

/// Run SQL against the user's databases.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "QueryDatabase",
    description = concat!(
        "\
Run SQL against the current user's Macro databases — the only way to read or change their \
rows. SELECT to answer a question, INSERT/UPDATE/DELETE to change data; several statements run \
in one transaction.\n\
\n\
**Every table the user can see is already in scope, across all of their databases.** There is \
no connecting or selecting a database first, and no `databaseId` argument: the statement is \
executed as the user, against a scratch database materialized from exactly what they are \
allowed to read. A table they cannot see simply does not exist, so a query can never leak \
somebody else's data — and a table they only have view access to is read-only.\n\
\n\
**Call DescribeDatabase first unless you already know the exact table and column names.** \
Names are derived from what the user typed, so \"Guest List\" is not necessarily `guest_list`, \
and a failed guess costs a whole round trip. If a statement does fail, the error is SQLite's \
own (\"no such column: guests.statuz\") — read it, fix the name, retry.\n\
\n\
## The magic tables\n\
\n",
        magic_tables_note!(),
        "\n\
\n\
## Dialect\n\
\n",
        sql_guide!(),
        "\n\
\n\
Results come back as columns and rows. A column whose values are entity ids carries an \
`entityType`, which is how the app renders it as a clickable chip rather than as raw text — \
prefer selecting an entity column over stringifying it. Writes report `changesApplied` and, \
for inserts, the `insertedRowIds` the server minted."
    )
)]
pub struct QueryDatabase {
    /// The statement(s) to run.
    #[schemars(
        description = "The SQL to run, as one string. Several statements are allowed and run in \
                       a single transaction — either all of the writes apply or none do. Use \
                       the SQL names DescribeDatabase reported, not the names the user says."
    )]
    pub sql: String,
}

impl ToolAnnotated for QueryDatabase {
    // Not read-only: the same tool is the write path. Not idempotent either —
    // re-running an INSERT inserts again.
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Query database");
}

/// One result column, with the provenance that drives chip rendering.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultColumn {
    /// Column name or alias, as the statement named it.
    pub name: String,
    /// The kind of entity this column's ids refer to, when it holds ids. The
    /// app renders those as chips.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
}

/// One SELECT's result set.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultSet {
    /// Result columns, in select order.
    pub columns: Vec<ToolResultColumn>,
    /// Rows as JSON scalars, in column order.
    pub rows: Vec<Vec<serde_json::Value>>,
}

impl From<QueryResult> for ToolResultSet {
    fn from(result: QueryResult) -> Self {
        Self {
            columns: result
                .columns
                .into_iter()
                .map(|column| ToolResultColumn {
                    name: column.name,
                    entity_type: column.entity_type.map(|t| t.as_ref().to_string()),
                })
                .collect(),
            rows: result
                .rows
                .into_iter()
                .map(|row| row.into_iter().map(json_scalar).collect())
                .collect(),
        }
    }
}

/// Render one cell as a plain JSON scalar.
fn json_scalar(value: SqlValue) -> serde_json::Value {
    match value {
        SqlValue::Null => serde_json::Value::Null,
        SqlValue::Integer(i) => serde_json::Value::from(i),
        SqlValue::Real(f) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            // A non-finite REAL has no JSON spelling; its text form is better
            // than dropping the cell to null and pretending it was empty.
            .unwrap_or_else(|| serde_json::Value::String(f.to_string())),
        SqlValue::Text(text) => serde_json::Value::String(text),
    }
}

/// Response from the QueryDatabase tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueryDatabaseResponse {
    /// One result set per SELECT, in statement order.
    pub results: Vec<ToolResultSet>,
    /// How many rows the statement changed.
    pub changes_applied: usize,
    /// Ids the server minted for inserted rows, in insertion order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub inserted_row_ids: Vec<Uuid>,
    /// New version of every table written, keyed by table id.
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub new_versions: HashMap<Uuid, i64>,
    /// Magic tables whose materialization hit its row cap. Any aggregate over
    /// one of these is computed on a partial table — say so rather than
    /// reporting the number as a total.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub truncated_tables: Vec<String>,
    /// A human-readable summary of what the statement did.
    pub summary: String,
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for QueryDatabase
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = QueryDatabaseResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Query database");

        // No receipt here, and that is the design: the catalog the service
        // builds for this viewer *is* the authorization, so there is no single
        // entity to mint a receipt for.
        let outcome = service_context
            .service
            .exec_sql(
                viewer_of(&request_context.user_id),
                ExecRequest {
                    sql: self.sql.clone(),
                    // Compare-and-swap is for surfaces that hold a stale copy
                    // of a table; a tool call has none.
                    base_versions: None,
                },
            )
            .await
            .map_err(query_error)?;

        let results: Vec<ToolResultSet> = outcome.results.into_iter().map(Into::into).collect();
        let summary = summarize(&results, outcome.changes_applied, &outcome.truncated_tables);

        Ok(QueryDatabaseResponse {
            results,
            changes_applied: outcome.changes_applied,
            inserted_row_ids: outcome.inserted_row_ids,
            truncated_tables: outcome.truncated_tables,
            new_versions: outcome
                .new_versions
                .into_iter()
                .map(|(table_id, version)| (table_id, version.0))
                .collect(),
            summary,
        })
    }
}

/// Say what happened, so a model does not have to infer "it worked" from an
/// empty result set — which reads identically to "nothing matched".
pub(super) fn summarize(
    results: &[ToolResultSet],
    changes_applied: usize,
    truncated_tables: &[String],
) -> String {
    let rows: usize = results.iter().map(|r| r.rows.len()).sum();
    let mut parts = Vec::new();

    if !results.is_empty() {
        parts.push(match rows {
            0 => "No rows matched.".to_string(),
            1 => "Returned 1 row.".to_string(),
            n => format!("Returned {n} rows."),
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
            "These tables hit their row cap and are incomplete: {}. Narrow the query rather \
             than treating any aggregate over them as a total.",
            truncated_tables.join(", ")
        ));
    }
    if parts.is_empty() {
        return "The statement ran and changed nothing.".to_string();
    }
    parts.join(" ")
}
