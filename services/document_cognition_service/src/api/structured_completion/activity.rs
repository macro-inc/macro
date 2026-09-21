//! Small execution receipts from the agent stream, never inferred from model text.

use agent::types::AssistantMessagePart;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

#[derive(Debug, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StructuredToolActivity {
    pub name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes_applied: Option<u64>,
}

pub(super) fn tool_activity(parts: &[AssistantMessagePart]) -> Vec<StructuredToolActivity> {
    parts
        .iter()
        .filter_map(|part| match part {
            AssistantMessagePart::ToolCallResponseJson { name, json, .. } => {
                Some(StructuredToolActivity {
                    name: name.clone(),
                    success: true,
                    changes_applied: json
                        .get("changesApplied")
                        .and_then(serde_json::Value::as_u64),
                })
            }
            AssistantMessagePart::ToolCallErr { name, .. } => Some(StructuredToolActivity {
                name: name.clone(),
                success: false,
                changes_applied: None,
            }),
            _ => None,
        })
        .collect()
}

pub(super) fn has_database_changes(activity: &[StructuredToolActivity]) -> bool {
    activity.iter().any(|entry| {
        entry.success
            && (matches!(
                entry.name.as_str(),
                "CreateDatabase"
                    | "CreateTable"
                    | "AddColumn"
                    | "AddColumnOptions"
                    | "SaveDatabaseView"
            ) || (entry.name == "QueryDatabase"
                && entry.changes_applied.is_some_and(|count| count > 0)))
    })
}
