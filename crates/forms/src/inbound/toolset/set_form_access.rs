use super::{FormsToolContext, tool_error};
use crate::domain::authoring::{MutationResult, SetAccess, ports::FormsAuthoringService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Share form through the owning domain workflow.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "SetFormAccess",
    description = "Open, close or share a saved form immediately. Requires Form Owner. Supply complete audience/status/deadline/tally settings and explicit channel grant deltas; empty deltas change no grants. Public allows anonymous responses. View allows responding without database access; channel Edit grants editing of the entire backing database. Uses the existing Forms settings and sharing services without a review step. This never posts a message or sends invitations. Settings and channel grants are separate writes; inspect partial results before retrying. Returns actual access, canonical links and acceptingResponses; a URL alone does not mean the form is open."
)]
pub struct SetFormAccess {
    /// Flat workflow arguments shared with the domain service.
    #[serde(flatten)]
    pub intent: SetAccess,
}
impl ToolAnnotated for SetFormAccess {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Share form");
}
#[async_trait]
impl<Service: FormsAuthoringService> AsyncTool<FormsToolContext<Service>> for SetFormAccess {
    type Output = MutationResult;
    async fn call(
        &self,
        context: ServiceContext<FormsToolContext<Service>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .set_form_access(context.viewer(request.user_id), self.intent.clone())
            .await
            .map_err(tool_error)
    }
}
