use super::{FormsToolContext, tool_error};
use crate::domain::authoring::{Edit, MutationResult, ports::FormsAuthoringService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Edit form through the owning domain workflow.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "EditForm",
    description = "Edit a form using typed targeted operations and the baseRevision from ReadForm. Unrelated human edits are preserved; conflicting fields or dependencies are refused, not overwritten. Changes can add or move questions/sections, edit requiredness/help/screeners and attach an existing booking target. New columns use explicit stable IDs. Question labels follow backing column names; rename them through database tools. Removing a question keeps its column and answers. Schema retyping and conditional column cleanup are unsupported. Keep screeners after the questions they test and booking last. Reuse requestId only for identical retries; read actual partial/pending outcomes before proceeding. Opening and sharing require SetFormAccess."
)]
pub struct EditForm {
    /// Flat workflow arguments shared with the domain service.
    #[serde(flatten)]
    pub intent: Edit,
}
impl ToolAnnotated for EditForm {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Edit form").with_idempotent();
}
#[async_trait]
impl<Service: FormsAuthoringService> AsyncTool<FormsToolContext<Service>> for EditForm {
    type Output = MutationResult;
    async fn call(
        &self,
        context: ServiceContext<FormsToolContext<Service>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .edit_form(context.viewer(request.user_id), self.intent.clone())
            .await
            .map_err(tool_error)
    }
}
