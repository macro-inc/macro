//! RemoveFromPipeline: take deals out of a pipeline.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use databases::domain::models::RowId;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{PipelineToolContext, ToolEntry, record_name, workflow_error};
use crate::domain::pipeline_workflows::{EntryTarget, PipelineWorkflowService};

/// Remove entries from a pipeline.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RemoveFromPipeline",
    description = "Remove deals (entries) from a CRM pipeline, deleting their stage and other pipeline fields. The companies and contacts themselves stay in the CRM and in other pipelines. Address entries by entryId, or by the company or contact id they track (which removes every entry of that record in this pipeline). Only when the user asked to remove them."
)]
pub struct RemoveFromPipeline {
    /// The pipeline.
    #[schemars(description = "The pipeline's id from ListPipelines.")]
    pub pipeline_id: Uuid,
    /// Entries to remove.
    #[schemars(description = "Entry ids from FindPipelineEntries.")]
    #[serde(default)]
    pub entry_ids: Vec<Uuid>,
    /// Records to take out.
    #[schemars(description = "CRM company or contact ids whose entries to remove.")]
    #[serde(default)]
    pub record_ids: Vec<Uuid>,
}

/// The entries removed.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoveFromPipelineResponse {
    /// Each removed entry as it was.
    pub removed: Vec<ToolEntry>,
    /// The pipeline's version after the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    /// What changed.
    pub summary: String,
}

impl ToolAnnotated for RemoveFromPipeline {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Remove from pipeline");
}

#[async_trait]
impl<Workflows: PipelineWorkflowService> AsyncTool<PipelineToolContext<Workflows>>
    for RemoveFromPipeline
{
    type Output = RemoveFromPipelineResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<PipelineToolContext<Workflows>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let targets = self
            .entry_ids
            .iter()
            .map(|id| EntryTarget::Entry(RowId::from_uuid(*id)))
            .chain(self.record_ids.iter().map(|id| EntryTarget::Record(*id)))
            .collect();
        let viewer = context.viewer(request_context.user_id);
        let removed = context
            .service
            .remove(&viewer, self.pipeline_id, targets)
            .await
            .map_err(workflow_error)?;
        let entries: Vec<ToolEntry> = removed.removed.iter().map(ToolEntry::from).collect();
        let summary = match entries.as_slice() {
            [] => "Removed nothing.".to_owned(),
            entries => format!(
                "Removed {} from the pipeline; the records stay in the CRM.",
                entries
                    .iter()
                    .map(|entry| record_name(&entry.record))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        };
        Ok(RemoveFromPipelineResponse {
            removed: entries,
            version: removed.version.map(|version| version.0),
            summary,
        })
    }
}
