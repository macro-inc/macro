//! Small execution receipts from the agent stream, never inferred from model text.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use agent::types::AssistantMessagePart;
use ai_toolset::ToolKind;
use ai_toolset::schema::generate_validated_input_schema;
use databases_sql::toolset::{QueryDatabase, SaveDatabaseQuery};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// One tool call the agent finished, and what it did.
#[derive(Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct StructuredToolActivity {
    pub name: String,
    pub outcome: ToolOutcome,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ToolOutcome {
    Succeeded { changes: DatabaseChange },
    Failed,
}

/// What a successful tool call committed to the user's databases.
#[derive(Debug, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DatabaseChange {
    None,
    /// Databases, tables, columns or saved views.
    Schema,
    Rows {
        count: u64,
    },
}

pub(super) fn tool_activity(parts: &[AssistantMessagePart]) -> Vec<StructuredToolActivity> {
    parts
        .iter()
        .filter_map(|part| match part {
            AssistantMessagePart::ToolCallResponseJson { name, json, .. } => {
                Some(StructuredToolActivity {
                    name: name.clone(),
                    outcome: ToolOutcome::Succeeded {
                        changes: database_change(name, json),
                    },
                })
            }
            AssistantMessagePart::ToolCallErr { name, .. } => Some(StructuredToolActivity {
                name: name.clone(),
                outcome: ToolOutcome::Failed,
            }),
            _ => None,
        })
        .collect()
}

pub(super) fn has_database_changes(activity: &[StructuredToolActivity]) -> bool {
    activity.iter().any(|entry| {
        matches!(
            &entry.outcome,
            ToolOutcome::Succeeded { changes } if *changes != DatabaseChange::None
        )
    })
}

/// The database tools, by name, with what each declares it does.
struct DatabaseTools {
    kinds: BTreeMap<String, ToolKind>,
    query_database: String,
    save_database_query: String,
}

fn database_tools() -> &'static DatabaseTools {
    static TOOLS: LazyLock<DatabaseTools> = LazyLock::new(|| DatabaseTools {
        kinds: ai_tools::database_tools()
            .tools
            .into_iter()
            .map(|(name, tool)| (name, tool.annotations.kind))
            .collect(),
        query_database: tool_name::<QueryDatabase>(),
        save_database_query: tool_name::<SaveDatabaseQuery>(),
    });
    &TOOLS
}

fn tool_name<Tool: schemars::JsonSchema>() -> String {
    generate_validated_input_schema::<Tool>()
        .expect("the database toolset already validated this schema")
        .name
}

/// The part of a QueryDatabase response that says what it wrote.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryDatabaseReceipt {
    changes_applied: u64,
    statement: ReceiptStatement,
}

/// The kinds of `databases_sql::SqlStatement`, which is serialize-only.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ReceiptStatement {
    Select,
    Insert,
    Update,
    Delete,
    AlterColumnType,
}

fn database_change(name: &str, response: &serde_json::Value) -> DatabaseChange {
    let tools = database_tools();
    if name == tools.query_database {
        return query_database_change(response);
    }
    // Saving a question writes no table.
    if name == tools.save_database_query {
        return DatabaseChange::None;
    }
    match tools.kinds.get(name) {
        None | Some(ToolKind::ReadOnly) => DatabaseChange::None,
        Some(ToolKind::Additive | ToolKind::Destructive) => DatabaseChange::Schema,
    }
}

fn query_database_change(response: &serde_json::Value) -> DatabaseChange {
    match QueryDatabaseReceipt::deserialize(response) {
        Ok(QueryDatabaseReceipt {
            statement: ReceiptStatement::AlterColumnType,
            ..
        }) => DatabaseChange::Schema,
        Ok(QueryDatabaseReceipt {
            changes_applied: 0, ..
        }) => DatabaseChange::None,
        Ok(QueryDatabaseReceipt {
            changes_applied, ..
        }) => DatabaseChange::Rows {
            count: changes_applied,
        },
        // Never conceal a write the receipt could not describe.
        Err(error) => {
            tracing::error!(error = ?error, "QueryDatabase response is not a receipt");
            DatabaseChange::Schema
        }
    }
}
