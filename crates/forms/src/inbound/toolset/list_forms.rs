use super::{FormsToolContext, tool_error};
use crate::domain::authoring::{List, ListResult, ports::FormsAuthoringService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Find forms through the owning domain workflow.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "ListForms",
    description = "Find forms the user has an explicit or inherited grant to. Filter by name query, status, minimum access or backing database. Returns up to 50 recent matches and a total; narrow filters when truncated. This does not enumerate all public forms or read response cells. Use ReadForm for an authoring baseline before editing."
)]
pub struct ListForms {
    /// Flat workflow arguments shared with the domain service.
    #[serde(flatten)]
    pub intent: List,
}
impl ToolAnnotated for ListForms {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Find forms");
}
#[async_trait]
impl<Service: FormsAuthoringService> AsyncTool<FormsToolContext<Service>> for ListForms {
    type Output = ListResult;
    async fn call(
        &self,
        context: ServiceContext<FormsToolContext<Service>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .list_forms(context.viewer(request.user_id), self.intent.clone())
            .await
            .map_err(tool_error)
    }
}
