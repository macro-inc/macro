use super::{FormsToolContext, tool_error};
use crate::domain::authoring::{Create, MutationResult, ports::FormsAuthoringService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Create form through the owning domain workflow.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "CreateForm",
    description = "Create a complete questionnaire with response columns, ordered sections, screeners and an optional saved booking link. Creates closed and private; use SetFormAccess afterward to open or share it. Existing-table attachment requires database Owner and an unbound table. Use local question/option keys in screeners and reference only earlier sections. Required questions require an answer; screeners compare answers using AND/OR. Empty answers pass only IsEmpty. A final booking step reveals an existing authorized link after acceptance; its independent URL remains usable, and strict qualification is unsupported. Reuse requestId only for the identical retry. Returns actual saved IDs, revision, links and completion state; inspect partial/pending work instead of recreating."
)]
pub struct CreateForm {
    /// Flat workflow arguments shared with the domain service.
    #[serde(flatten)]
    pub intent: Create,
}
impl ToolAnnotated for CreateForm {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create form").with_idempotent();
}
#[async_trait]
impl<Service: FormsAuthoringService> AsyncTool<FormsToolContext<Service>> for CreateForm {
    type Output = MutationResult;
    async fn call(
        &self,
        context: ServiceContext<FormsToolContext<Service>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .create_form(context.viewer(request.user_id), self.intent.clone())
            .await
            .map_err(tool_error)
    }
}
