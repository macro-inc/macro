//! EditPipeline: rename, share, and change the stages and fields of a pipeline.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{PipelineToolContext, ToolNewField, ToolPipeline, workflow_error};
use crate::domain::{
    pipeline_workflows::{PipelineEdit, PipelineWorkflowService},
    pipelines::PipelineSharing,
};

/// A field to rename.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolRename {
    /// Current name.
    #[schemars(description = "The current name.")]
    pub from: String,
    /// New name.
    #[schemars(description = "The new name.")]
    pub to: String,
}

/// Options to add to a select field.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolAddOptions {
    /// The field.
    #[schemars(description = "The select field, e.g. \"Stage\".")]
    pub field: String,
    /// New labels.
    #[schemars(description = "Labels to add after the existing ones.")]
    pub labels: Vec<String>,
}

/// An option to relabel.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolRenameOption {
    /// The field.
    #[schemars(description = "The select field, e.g. \"Stage\".")]
    pub field: String,
    /// Current label.
    #[schemars(description = "The option's current label.")]
    pub from: String,
    /// New label.
    #[schemars(description = "Its new label; entries holding it keep it.")]
    pub to: String,
}

/// An option to delete.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolRemoveOption {
    /// The field.
    #[schemars(description = "The select field, e.g. \"Stage\".")]
    pub field: String,
    /// The label.
    #[schemars(description = "The option to delete.")]
    pub label: String,
}

/// Change a pipeline.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "EditPipeline",
    description = "Change a CRM pipeline itself: rename it, share it with the team or make it private (owner only), add, rename or remove fields, and add, rename or remove stages and other select options. Stages are the options of the Stage field: to add a stage use addOptions on \"Stage\"; to rename one use renameOptions. Removing a field deletes its values from every entry, and removing a stage or option empties it on the entries holding it, so do that only when the user asked. New options go after the existing ones. Field changes apply together, all or nothing. Returns the pipeline with its fields as they are now."
)]
pub struct EditPipeline {
    /// The pipeline.
    #[schemars(description = "The pipeline's id from ListPipelines.")]
    pub pipeline_id: Uuid,
    /// New name.
    #[schemars(description = "A new name for the pipeline.")]
    #[serde(default)]
    pub name: Option<String>,
    /// Team sharing.
    #[schemars(
        description = "true lets the user's team see and edit it; false makes it private to its owner. Only the owner can change this."
    )]
    #[serde(default)]
    pub shared_with_team: Option<bool>,
    /// Fields to add.
    #[schemars(description = "Fields to add after the existing ones.")]
    #[serde(default)]
    pub add_fields: Vec<ToolNewField>,
    /// Fields to rename.
    #[schemars(description = "Fields to rename.")]
    #[serde(default)]
    pub rename_fields: Vec<ToolRename>,
    /// Fields to remove.
    #[schemars(
        description = "Names of fields to delete with their values. The Company or Contact field cannot be removed."
    )]
    #[serde(default)]
    pub remove_fields: Vec<String>,
    /// Options to add.
    #[schemars(description = "Stages or other select options to add.")]
    #[serde(default)]
    pub add_options: Vec<ToolAddOptions>,
    /// Options to relabel.
    #[schemars(description = "Stages or other select options to relabel.")]
    #[serde(default)]
    pub rename_options: Vec<ToolRenameOption>,
    /// Options to delete.
    #[schemars(description = "Stages or other select options to delete.")]
    #[serde(default)]
    pub remove_options: Vec<ToolRemoveOption>,
}

/// The pipeline after the change.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditPipelineResponse {
    /// The pipeline as it is now.
    pub pipeline: ToolPipeline,
    /// What changed.
    pub summary: String,
}

impl ToolAnnotated for EditPipeline {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Edit pipeline");
}

#[async_trait]
impl<Workflows: PipelineWorkflowService> AsyncTool<PipelineToolContext<Workflows>>
    for EditPipeline
{
    type Output = EditPipelineResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<PipelineToolContext<Workflows>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let viewer = context.viewer(request_context.user_id);
        let edited = context
            .service
            .edit(
                &viewer,
                self.pipeline_id,
                PipelineEdit {
                    name: self.name.clone(),
                    sharing: self.shared_with_team.map(|shared| {
                        if shared {
                            PipelineSharing::Team
                        } else {
                            PipelineSharing::Private
                        }
                    }),
                    add_fields: self.add_fields.iter().map(Into::into).collect(),
                    rename_fields: self
                        .rename_fields
                        .iter()
                        .map(|rename| (rename.from.clone(), rename.to.clone()))
                        .collect(),
                    remove_fields: self.remove_fields.clone(),
                    add_options: self
                        .add_options
                        .iter()
                        .map(|add| (add.field.clone(), add.labels.clone()))
                        .collect(),
                    rename_options: self
                        .rename_options
                        .iter()
                        .map(|rename| {
                            (rename.field.clone(), rename.from.clone(), rename.to.clone())
                        })
                        .collect(),
                    remove_options: self
                        .remove_options
                        .iter()
                        .map(|remove| (remove.field.clone(), remove.label.clone()))
                        .collect(),
                },
            )
            .await
            .map_err(workflow_error)?;
        let pipeline = ToolPipeline::from(&edited);
        let summary = format!("Updated pipeline \"{}\".", pipeline.name);
        Ok(EditPipelineResponse { pipeline, summary })
    }
}
