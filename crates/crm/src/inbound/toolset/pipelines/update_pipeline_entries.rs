//! UpdatePipelineEntries: move deals between stages and change their fields.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use databases::domain::models::{RowId, TableVersion};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    PipelineToolContext, ToolFieldValue, ToolRecord, json, pairs, record_name, workflow_error,
};
use crate::domain::pipeline_workflows::{EntryTarget, EntryUpdate, PipelineWorkflowService};

/// The changes to one entry.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntryUpdate {
    /// The entry's id.
    #[schemars(description = "The entry's id from FindPipelineEntries. Give this or recordId.")]
    #[serde(default)]
    pub entry_id: Option<Uuid>,
    /// The tracked record's id.
    #[schemars(
        description = "Instead of entryId: the CRM company or contact id the entry tracks. Refused if the record has several entries in this pipeline; then use entryId."
    )]
    #[serde(default)]
    pub record_id: Option<Uuid>,
    /// Fields to set.
    #[schemars(
        description = "Fields to set, e.g. [{\"field\": \"Stage\", \"value\": \"Negotiation\"}, {\"field\": \"Revenue\", \"value\": \"48000\"}]. Leave value out to empty a field."
    )]
    pub set: Vec<ToolFieldValue>,
}

/// Change entries of a pipeline.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdatePipelineEntries",
    description = "Move deals to another stage or change their fields in a CRM pipeline: \"move Acme to Negotiation\", \"set the revenue on the Globex deal\", \"assign these deals to Sam\". Address each entry by entryId (from FindPipelineEntries) or by the company or contact id it tracks, and set fields by name with text values: stages and other options by label, people as \"me\", an email or a macro| user id, numbers, true/false, or dates. Several entries change in one call, all or nothing. Returns each field before and after. This changes the entry in the pipeline, not the company's own properties."
)]
pub struct UpdatePipelineEntries {
    /// The pipeline.
    #[schemars(description = "The pipeline's id from ListPipelines.")]
    pub pipeline_id: Uuid,
    /// What to change.
    #[schemars(description = "The entries to change, each with its fields to set.")]
    pub updates: Vec<ToolEntryUpdate>,
    /// The version the change is based on.
    #[schemars(
        description = "Optional: the pipeline version from the FindPipelineEntries read these changes are based on. The update is refused if the pipeline changed since; leave out for a direct change."
    )]
    #[serde(default)]
    pub base_version: Option<i64>,
}

/// One field's value before and after.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolFieldChange {
    /// The field.
    pub field: String,
    /// Its value before; null when it was empty.
    pub before: serde_json::Value,
    /// Its value now; null when it is empty.
    pub after: serde_json::Value,
}

/// An updated entry.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolUpdatedEntry {
    /// The entry.
    pub entry_id: Uuid,
    /// The company or contact it tracks.
    pub record: ToolRecord,
    /// The fields set.
    pub changes: Vec<ToolFieldChange>,
}

/// The entries changed.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePipelineEntriesResponse {
    /// Each changed entry, as saved.
    pub updated: Vec<ToolUpdatedEntry>,
    /// The pipeline's version after the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    /// What changed.
    pub summary: String,
}

impl ToolAnnotated for UpdatePipelineEntries {
    // Destructive: a set overwrites the value that was there.
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Update pipeline entries").with_idempotent();
}

#[async_trait]
impl<Workflows: PipelineWorkflowService> AsyncTool<PipelineToolContext<Workflows>>
    for UpdatePipelineEntries
{
    type Output = UpdatePipelineEntriesResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<PipelineToolContext<Workflows>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let updates = self
            .updates
            .iter()
            .map(|update| {
                let target = match (update.entry_id, update.record_id) {
                    (Some(entry), None) => EntryTarget::Entry(RowId::from_uuid(entry)),
                    (None, Some(record)) => EntryTarget::Record(record),
                    _ => {
                        return Err(ToolCallError {
                            description: "Give each update exactly one of entryId or recordId."
                                .to_owned(),
                            internal_error: anyhow::anyhow!("update without one target"),
                        });
                    }
                };
                Ok(EntryUpdate {
                    target,
                    set: pairs(&update.set),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let viewer = context.viewer(request_context.user_id);
        let updated = context
            .service
            .update(
                &viewer,
                self.pipeline_id,
                updates,
                self.base_version.map(TableVersion),
            )
            .await
            .map_err(workflow_error)?;
        let entries: Vec<ToolUpdatedEntry> = updated
            .updated
            .iter()
            .map(|entry| ToolUpdatedEntry {
                entry_id: entry.entry_id.into_uuid(),
                record: (&entry.record).into(),
                changes: entry
                    .changes
                    .iter()
                    .map(|change| ToolFieldChange {
                        field: change.field.clone(),
                        before: change.before.as_ref().map_or(serde_json::Value::Null, json),
                        after: change.after.as_ref().map_or(serde_json::Value::Null, json),
                    })
                    .collect(),
            })
            .collect();
        let summary = format!(
            "Updated {}.",
            entries
                .iter()
                .map(|entry| {
                    let fields: Vec<String> = entry
                        .changes
                        .iter()
                        .map(|change| {
                            format!("{} {} → {}", change.field, change.before, change.after)
                        })
                        .collect();
                    format!("{} ({})", record_name(&entry.record), fields.join("; "))
                })
                .collect::<Vec<_>>()
                .join(", ")
        );
        Ok(UpdatePipelineEntriesResponse {
            updated: entries,
            version: updated.version.map(|version| version.0),
            summary,
        })
    }
}
