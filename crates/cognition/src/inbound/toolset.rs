//! Generation and decisions shared by chat, agents, and public MCP.

use crate::domain::{
    Cognition, CognitionError, DecisionRequest, DecisionResponse, GenerateObjectRequest,
    GenerateObjectResponse,
};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use rootcause::Report;
use rootcause::compat::anyhow1::IntoAnyhow;
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Shared service; an unconfigured context returns an explicit error.
#[derive(Clone, Default)]
pub struct CognitionToolContext {
    /// The composition root's authenticated cognition service client.
    pub service: Option<Arc<dyn Cognition>>,
}

impl CognitionToolContext {
    fn configured(&self) -> Result<&dyn Cognition, Report> {
        self.service
            .as_deref()
            .ok_or_else(|| CognitionError::Unavailable.into())
    }
}

/// Tool-free language generation and yes/no classification.
pub fn cognition_toolset() -> AsyncToolCollection<CognitionToolContext> {
    AsyncToolCollection::new()
        .add_tool::<GenerateObject, CognitionToolContext>()
        .add_tool::<Decide, CognitionToolContext>()
}

/// Generate structured data using the user's accessible models.
#[derive(Deserialize, JsonSchema)]
#[serde(transparent)]
#[schemars(
    title = "GenerateObject",
    description = "Generate a JSON object from supplied text using a JSON Schema. Use for extraction, rewriting, or summarizing already-fetched context. This completion cannot search, read, or edit Macro data: include the necessary source text in prompt. Omit model for the default, or use an accessible provider/model ID. Returns {object}. Generation is metered to the requesting user; preserve source IDs and verify uncertain extracted facts."
)]
pub struct GenerateObject(GenerateObjectRequest);

impl ToolAnnotated for GenerateObject {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Generate structured data")
        .with_open_world()
        .without_idempotent();
}

#[async_trait]
impl AsyncTool<CognitionToolContext> for GenerateObject {
    type Output = GenerateObjectResponse;

    async fn call(
        &self,
        context: ServiceContext<CognitionToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let service = context.configured().map_err(tool_error)?;
        tokio::select! {
            biased;
            () = request.cancel.cancelled() => Err(cancelled()),
            result = service.generate_object(&request.user_id, self.0.clone()) => result.map_err(tool_error),
        }
    }
}

/// Ask multiple yes/no questions about one input through Jev.
#[derive(Deserialize, JsonSchema)]
#[serde(transparent)]
#[schemars(
    title = "Decide",
    description = "Estimate probabilities for named yes/no questions about supplied JSON or text using Jev. Use for triage and classification, not text generation or factual verification. Ask 1–32 questions about one input in a single request; input and questions must fit in 64 KiB. Returns {probabilities: {questionName: number}} with probability of yes in [0,1]. Probabilities are estimates and questions need not be mutually exclusive. Classification does not authorize any action."
)]
pub struct Decide(DecisionRequest);

impl ToolAnnotated for Decide {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Classify supplied data")
        .with_open_world()
        .without_idempotent();
}

#[async_trait]
impl AsyncTool<CognitionToolContext> for Decide {
    type Output = DecisionResponse;

    async fn call(
        &self,
        context: ServiceContext<CognitionToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let service = context.configured().map_err(tool_error)?;
        tokio::select! {
            biased;
            () = request.cancel.cancelled() => Err(cancelled()),
            result = service.decide(&request.user_id, self.0.clone()) => result.map_err(tool_error),
        }
    }
}

fn cancelled() -> ToolCallError {
    tool_error(rootcause::report!(
        "AI request cancelled. Already dispatched provider usage may still be recorded."
    ))
}

fn tool_error(error: Report) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: error.into_anyhow(),
    }
}
