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
    description = "Edit the live form using typed targeted operations. ReadForm provides stable question/section IDs. Edits produce granular CRDT updates; concurrent changes merge using the same rules as the builder. Omitted fields stay unchanged. Invalid merged layouts are refused. Changes can add or move questions/sections, edit requiredness/help/screeners and attach an existing booking target. New columns use explicit stable IDs. Question labels follow backing column names; rename them through database tools. Removing a question keeps its column and answers. Schema retyping and conditional column cleanup are unsupported. Keep screeners after the questions they test and booking last. Read the current form after a timeout or partial result before proceeding. Opening and sharing require SetFormAccess."
)]
pub struct EditForm {
    /// Flat workflow arguments shared with the domain service.
    #[serde(flatten)]
    pub intent: Edit,
}
impl ToolAnnotated for EditForm {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Edit form");
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
