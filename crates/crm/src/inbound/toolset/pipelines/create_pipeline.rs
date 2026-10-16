//! CreatePipeline: a new CRM pipeline with its stages and fields.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{PipelineToolContext, ToolNewField, ToolPipeline, ToolRecordType, workflow_error};
use crate::domain::{
    pipeline_workflows::{NewPipeline, PipelineWorkflowService},
    pipelines::PipelineSharing,
};

/// Create a pipeline.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreatePipeline",
    description = "Create a CRM pipeline: a board of deals that move through stages, such as a sales, renewals, fundraising, hiring or partnership pipeline. Each entry tracks either a company or a contact. Every pipeline starts with the tracked record, Stage, Owner and Revenue fields; Stage starts with the team's default stages unless `stages` gives others. Only when the user asked for a new pipeline: check ListPipelines first so you do not create a duplicate. Returns the pipeline with its id and fields."
)]
pub struct CreatePipeline {
    /// Its name.
    #[schemars(description = "The pipeline's name, e.g. \"Q4 Renewals\".")]
    pub name: String,
    /// What entries track.
    #[schemars(
        description = "\"company\" for deals with organizations, \"contact\" for deals with individual people (candidates, investors, partners)."
    )]
    pub tracks: ToolRecordType,
    /// Team sharing.
    #[schemars(
        description = "Let the user's team see and edit it. Defaults to false: only the user can see it."
    )]
    #[serde(default)]
    pub shared_with_team: Option<bool>,
    /// Its stages.
    #[schemars(
        description = "The stages, first to last, e.g. [\"Sourced\", \"Screen\", \"Interview\", \"Offer\", \"Hired\"]. Leave empty for the team's default stages."
    )]
    #[serde(default)]
    pub stages: Vec<String>,
    /// More fields.
    #[schemars(description = "Fields to add after Company/Contact, Stage, Owner and Revenue.")]
    #[serde(default)]
    pub fields: Vec<ToolNewField>,
}

/// The pipeline created.
#[derive(Debug, serde::Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePipelineResponse {
    /// The new pipeline.
    pub pipeline: ToolPipeline,
    /// What changed.
    pub summary: String,
}

impl ToolAnnotated for CreatePipeline {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create pipeline");
}

#[async_trait]
impl<Workflows: PipelineWorkflowService> AsyncTool<PipelineToolContext<Workflows>>
    for CreatePipeline
{
    type Output = CreatePipelineResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<PipelineToolContext<Workflows>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let viewer = context.viewer(request_context.user_id);
        let created = context
            .service
            .create(
                &viewer,
                NewPipeline {
                    name: self.name.clone(),
                    record_type: self.tracks.into(),
                    sharing: if self.shared_with_team.unwrap_or(false) {
                        PipelineSharing::Team
                    } else {
                        PipelineSharing::Private
                    },
                    stages: self.stages.clone(),
                    fields: self.fields.iter().map(Into::into).collect(),
                },
            )
            .await
            .map_err(workflow_error)?;
        let pipeline = ToolPipeline::from(&created);
        let summary = format!(
            "Created pipeline \"{}\" ({}).",
            pipeline.name,
            if pipeline.shared_with_team {
                "shared with the team"
            } else {
                "private"
            }
        );
        Ok(CreatePipelineResponse { pipeline, summary })
    }
}
