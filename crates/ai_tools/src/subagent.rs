use agent::PredefinedModel;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use axum::extract::FromRef;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::select;

use crate::ToolServiceContext;
use crate::ai_operations::{AiOperationError, AiOperations};

#[cfg(test)]
mod test;

/// Only the AI capabilities a subagent needs, inherited from the host context.
#[derive(Clone)]
pub(crate) struct SubagentContext {
    operations: AiOperations,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
    usage_context: ai_usage::UsageContext,
}

impl FromRef<ToolServiceContext> for SubagentContext {
    fn from_ref(context: &ToolServiceContext) -> Self {
        Self {
            operations: AiOperations::new(context.admission.clone()),
            recorder: context.recorder.clone(),
            usage_context: context.usage_context.clone(),
        }
    }
}

fn usage_for_request(
    inherited: &ai_usage::UsageContext,
    request: &RequestContext,
) -> ai_usage::UsageContext {
    ai_usage::UsageContext::new(inherited.feature, request.user_id.clone())
        .with_entity(inherited.entity)
}

fn operation_error(error: AiOperationError) -> ToolCallError {
    let description = match &error {
        AiOperationError::Admission(error) => format!("{}: {error}", error.code()),
        AiOperationError::Execution(_) => "subagent encountered an error".to_string(),
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

static SUBAGENT_MODEL: PredefinedModel = PredefinedModel::Smart;

static SUBAGENT_PROMPT: &str = include_str!("prompts/subagent.md");

#[derive(Debug, Serialize, JsonSchema)]
pub struct SubagentResponse {
    pub result: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "Subagent",
    description = "Delegate a task to a subagent that can independently use tools to research and complete it. The subagent has access to search, documents, properties, calls, and channel tools. Use this for tasks that require multiple tool calls or independent research."
)]
pub struct Subagent {
    #[schemars(
        description = "A detailed description of the task for the subagent to complete. Be specific about what information to find or what action to take."
    )]
    pub task: String,
}

impl ToolAnnotated for Subagent {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delegate to subagent").with_open_world();
}

#[async_trait]
impl AsyncTool<SubagentContext> for Subagent {
    type Output = SubagentResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<SubagentContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        // Subagents have no feature of their own — their usage rolls up into the
        // feature that spawned them, carried on the service context.
        //
        // Cooperative cancellation: race the completion against the request's
        // cancel token. If the user cancels, drop the in-flight completion and
        // report "cancelled" rather than a partial or errored result.
        let usage = usage_for_request(&service_context.usage_context, &request_context);
        let completion = service_context.operations.run(&usage, || {
            agent::complete(
                SUBAGENT_MODEL,
                SUBAGENT_PROMPT,
                &self.task,
                service_context.recorder.as_ref(),
                usage.clone(),
            )
        });

        select! {
            biased;
            _ = request_context.cancel.cancelled() => Ok(SubagentResponse {
                result: "cancelled".to_string(),
            }),
            result = completion => result
                .map_err(operation_error)
                .map(|result| SubagentResponse { result }),
        }
    }
}
