use super::{FormsToolContext, tool_error};
use crate::domain::authoring::{Read, ReadResult, ports::FormsAuthoringService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Read form through the owning domain workflow.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "ReadForm",
    description = "Read a known form before editing. Authoring view requires Edit and returns the actual durable collaborative draft, current schema, stable IDs and current settings. Respondent view returns only safe projected content, never hidden booking targets or response rows. Optional summary requires Edit. After a partial write, inspect the returned formId before making further changes. A respondent link may exist while responses are closed; check acceptingResponses."
)]
pub struct ReadForm {
    /// Flat workflow arguments shared with the domain service.
    #[serde(flatten)]
    pub intent: Read,
}
impl ToolAnnotated for ReadForm {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read form");
}
#[async_trait]
impl<Service: FormsAuthoringService> AsyncTool<FormsToolContext<Service>> for ReadForm {
    type Output = ReadResult;
    async fn call(
        &self,
        context: ServiceContext<FormsToolContext<Service>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .read_form(context.viewer(request.user_id), self.intent.clone())
            .await
            .map_err(tool_error)
    }
}
