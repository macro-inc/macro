//! A saved review presentation is a completed tool call, never a suspended approval.
use crate::domain::reviews::{CreateReview, ReviewService};
use agent_session::domain::model::AgentSession;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

/// Authenticated session facts and the shared persisted review service.
#[derive(Clone)]
pub struct ReviewToolContext {
    /// Review use cases, independent of whether code execution is enabled.
    pub service: ReviewService,
    /// Session authenticated by the internal MCP bearer credential.
    pub session: AgentSession,
}

/// Available to every agent harness, including agents without code execution.
pub fn toolset() -> AsyncToolCollection<ReviewToolContext> {
    AsyncToolCollection::new().add_tool::<PresentReview, ReviewToolContext>()
}

/// Persist editable drafts and immediately present their review component.
#[derive(Deserialize, JsonSchema)]
#[serde(transparent)]
#[schemars(
    title = "PresentReview",
    description = "Present an editable email stack or calendar event stack to the user without pausing the conversation. Returns immediately after the saved review is displayed; it does not send email, create an event, or wait for approval. User decisions later deliver their recorded outcomes through private session context. Use the existing ACP question tool for questions. Supply kind (email, calendar), title, and 1–100 drafts. Email drafts use SendEmail arguments (Markdown body); calendar drafts use CreateCalendarEvent arguments. executionId is optional and should be omitted outside ExecuteCode. Do not automatically submit these drafts or duplicate completed actions."
)]
pub struct PresentReview(CreateReview);

impl ToolAnnotated for PresentReview {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Present editable review").without_idempotent();
}

#[async_trait]
impl AsyncTool<ReviewToolContext> for PresentReview {
    type Output = Value;

    async fn call(
        &self,
        context: ServiceContext<ReviewToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let record = context
            .service
            .create_for_session(&context.session, &request.user_id, self.0.clone())
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: anyhow::anyhow!(error.to_string()),
            })?;
        Ok(json!({"reviewId": record.id, "kind": record.kind, "message": "Presented to the user"}))
    }
}
