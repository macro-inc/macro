//! ListPipelines: the user's CRM pipelines with their stages and fields.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{PipelineToolContext, ToolPipeline, workflow_error};
use crate::domain::pipeline_workflows::PipelineWorkflowService;

/// List the user's CRM pipelines.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[schemars(
    title = "ListPipelines",
    description = "List the user's CRM pipelines (deal pipelines, sales pipelines, hiring or partner pipelines) with their stages and fields. A pipeline holds entries (deals); each entry tracks one CRM company or contact and has its own fields, such as Stage, Owner and Revenue. Each pipeline lists its id, whether it tracks companies or contacts, the user's access, and its fields in order with their types; a select field lists its options, so Stage lists the pipeline's stages from first to last. Call this first whenever the user talks about deals, a pipeline, a stage, or moving a company or contact along, then use FindPipelineEntries, AddToPipeline and UpdatePipelineEntries with the returned pipelineId and field names. When the user names no pipeline and there is exactly one, use it; when several could match, ask which one."
)]
pub struct ListPipelines {}

/// The user's pipelines.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelinesResponse {
    /// Every live pipeline the user can see.
    pub pipelines: Vec<ToolPipeline>,
    /// What was found.
    pub summary: String,
}

impl ToolAnnotated for ListPipelines {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List pipelines");
}

#[async_trait]
impl<Workflows: PipelineWorkflowService> AsyncTool<PipelineToolContext<Workflows>>
    for ListPipelines
{
    type Output = ListPipelinesResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<PipelineToolContext<Workflows>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let viewer = context.viewer(request_context.user_id);
        let pipelines: Vec<ToolPipeline> = context
            .service
            .pipelines(&viewer)
            .await
            .map_err(workflow_error)?
            .iter()
            .map(ToolPipeline::from)
            .collect();
        let summary = match pipelines.as_slice() {
            [] => "The user has no pipelines. CreatePipeline makes one.".to_owned(),
            [one] => format!("The user has one pipeline, \"{}\".", one.name),
            many => format!("The user has {} pipelines.", many.len()),
        };
        Ok(ListPipelinesResponse { pipelines, summary })
    }
}
