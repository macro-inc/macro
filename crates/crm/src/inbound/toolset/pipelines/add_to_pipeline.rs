//! AddToPipeline: put companies or contacts into a pipeline as new deals.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{PipelineToolContext, ToolEntry, ToolFieldValue, pairs, record_name, workflow_error};
use crate::domain::pipeline_workflows::{EntryAddition, PipelineWorkflowService, RecordTarget};

/// One company or contact to add.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolNewEntry {
    /// The record's id.
    #[schemars(
        description = "The CRM company or contact id to add (company ids come from ListCompanies). Give this or email."
    )]
    #[serde(default)]
    pub record_id: Option<Uuid>,
    /// A contact's email.
    #[schemars(
        description = "A contact's email address instead of an id: adds that contact, or in a company pipeline the contact's company."
    )]
    #[serde(default)]
    pub email: Option<String>,
    /// Fields to fill in.
    #[schemars(
        description = "Fields to fill in on the new entry, e.g. [{\"field\": \"Stage\", \"value\": \"Lead\"}, {\"field\": \"Owner\", \"value\": \"me\"}]."
    )]
    #[serde(default)]
    pub set: Vec<ToolFieldValue>,
}

/// Add records to a pipeline.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "AddToPipeline",
    description = "Add companies or contacts to a CRM pipeline as new deals (entries), optionally setting their stage, owner, revenue or other fields. A company pipeline takes companies and a contact pipeline takes contacts (see ListPipelines' `tracks`). A record already in the pipeline is not added again unless allowDuplicates is true (for a second, separate deal); its existing entry is returned in alreadyPresent instead. Returns the new entries with their entryIds and fields as saved."
)]
pub struct AddToPipeline {
    /// The pipeline.
    #[schemars(description = "The pipeline's id from ListPipelines.")]
    pub pipeline_id: Uuid,
    /// What to add.
    #[schemars(description = "The companies or contacts to add, each with its starting fields.")]
    pub entries: Vec<ToolNewEntry>,
    /// Whether to add a record that is already in the pipeline.
    #[schemars(
        description = "Add a record again even if it already has an entry in this pipeline. Only for a genuinely separate second deal. Defaults to false."
    )]
    #[serde(default)]
    pub allow_duplicates: Option<bool>,
}

/// The entries added.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddToPipelineResponse {
    /// The new entries, as saved.
    pub added: Vec<ToolEntry>,
    /// Existing entries of requested records that were not added again.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub already_present: Vec<ToolEntry>,
    /// The pipeline's version after the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    /// What changed.
    pub summary: String,
}

impl ToolAnnotated for AddToPipeline {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Add to pipeline");
}

#[async_trait]
impl<Workflows: PipelineWorkflowService> AsyncTool<PipelineToolContext<Workflows>>
    for AddToPipeline
{
    type Output = AddToPipelineResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<PipelineToolContext<Workflows>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let additions = self
            .entries
            .iter()
            .map(|entry| {
                let record = match (entry.record_id, &entry.email) {
                    (Some(id), None) => RecordTarget::Id(id),
                    (None, Some(email)) => RecordTarget::Email(email.trim().to_owned()),
                    _ => {
                        return Err(ToolCallError {
                            description: "Give each entry exactly one of recordId or email."
                                .to_owned(),
                            internal_error: anyhow::anyhow!("entry without one record"),
                        });
                    }
                };
                Ok(EntryAddition {
                    record,
                    set: pairs(&entry.set),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let viewer = context.viewer(request_context.user_id);
        let added = context
            .service
            .add(
                &viewer,
                self.pipeline_id,
                additions,
                self.allow_duplicates.unwrap_or(false),
            )
            .await
            .map_err(workflow_error)?;
        let added_entries: Vec<ToolEntry> = added.added.iter().map(ToolEntry::from).collect();
        let present: Vec<ToolEntry> = added.already_present.iter().map(ToolEntry::from).collect();
        let mut summary = match added_entries.as_slice() {
            [] => "Added nothing.".to_owned(),
            entries => format!(
                "Added {}.",
                entries
                    .iter()
                    .map(|entry| record_name(&entry.record))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        };
        if !present.is_empty() {
            summary.push_str(&format!(
                " Already in the pipeline, so not added again: {}.",
                present
                    .iter()
                    .map(|entry| record_name(&entry.record))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        Ok(AddToPipelineResponse {
            added: added_entries,
            already_present: present,
            version: added.version.map(|version| version.0),
            summary,
        })
    }
}
