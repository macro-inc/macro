//! In-process agent-loop adapter that materializes ai projection results using
//! the shared AI toolset.
//!
//! Mirrors `channel_bots::outbound::AgentLoopResponder`: it runs the projection
//! prompt through the same agent loop and toolset used by channel bots and the
//! document storage service, attributing usage to [`AiFeature::AiProjection`].
//!
//! When the projection defines an `output_schema`, generation is two-phase
//! (mirroring the `/structured-completion` endpoint): the agent loop first
//! gathers information with tools, then a prompted structured completion
//! (`agent::structured_output`) distills the gathered context into JSON
//! conforming to the schema. Prompted JSON works with every routed provider —
//! Anthropic, OpenAI, and OpenAI-compatible providers like Cerebras — without
//! requiring strict schema support.

use std::sync::Arc;

use agent::{AgentLoop, StreamAccumulator, to_rig_messages};
use agent::{PredefinedModel, structured_output::DynamicSchema};
use ai_tools::{AiToolSet, ToolServiceContext, ToolSetWithPrompt};
use ai_usage::{AiFeature, UsageContext};
use futures::StreamExt;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use crate::domain::{
    model::AiProjectionError,
    projection_generator::{GenerationRequest, ProjectionGenerator},
};

/// [`ProjectionGenerator`] backed by the in-process agent loop and AI toolset.
#[derive(Clone)]
pub struct AgentProjectionGenerator {
    tool_context: Arc<ToolServiceContext>,
    toolset: Arc<AiToolSet>,
    system_prompt: Arc<str>,
}

impl AgentProjectionGenerator {
    /// Creates a generator from a pre-configured tool context and toolset, e.g.
    /// [`ai_tools::build_tool_service_context_from_env`] and
    /// [`ai_tools::all_tools`].
    pub fn new(tool_context: ToolServiceContext, tools: ToolSetWithPrompt) -> Self {
        Self {
            tool_context: Arc::new(tool_context),
            toolset: tools.toolset,
            system_prompt: tools.prompt.to_string().into(),
        }
    }

    /// Runs the agent loop over the prompt as `user_id`, returning the yielded
    /// stream parts (text, tool calls/responses) for downstream use.
    async fn run_agent_loop(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: &GenerationRequest<'_>,
    ) -> Result<StreamAccumulator, AiProjectionError> {
        let usage_ctx = UsageContext::new(AiFeature::AiProjection, user_id.clone().into_owned());

        // Carry the feature on the context so tool-spawned subagents attribute
        // to it as well.
        let mut tool_context = (*self.tool_context).clone();
        tool_context.usage_context = usage_ctx.clone();

        let toolset: Arc<dyn ai_toolset::ToolSet<ToolServiceContext> + Send + Sync> =
            self.toolset.clone();

        let mut agent_loop = AgentLoop::new(self.tool_context.recorder.clone());
        if let Some(model) = request.model {
            agent_loop = agent_loop.with_model(model);
        }

        let mut session = agent_loop
            .session(
                toolset,
                Arc::new(tool_context),
                &self.system_prompt,
                usage_ctx,
            )
            .await;

        let messages = vec![agent::types::ChatMessage {
            role: agent::types::Role::User,
            content: agent::types::ChatMessageContent::Text(request.prompt.to_string()),
            attachments: None,
        }];

        let mut stream = session
            .send_message(to_rig_messages(&messages))
            .await
            .map_err(|e| AiProjectionError::Generation(e.to_string()))?;

        let mut accumulator = StreamAccumulator::new();
        while let Some(part) = stream.next().await {
            let part = part.map_err(|e| AiProjectionError::Generation(e.to_string()))?;
            accumulator.push(part);
        }

        Ok(accumulator)
    }

    /// Distills the agent loop's gathered context into JSON conforming to
    /// `output_schema` via a prompted (non-strict) structured completion.
    async fn structured_result(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: &GenerationRequest<'_>,
        accumulator: StreamAccumulator,
    ) -> Result<String, AiProjectionError> {
        let output_schema = request
            .output_schema
            .expect("structured_result requires an output schema");

        let conversation = vec![
            agent::types::ChatMessage {
                role: agent::types::Role::User,
                content: agent::types::ChatMessageContent::Text(request.prompt.to_string()),
                attachments: None,
            },
            agent::types::ChatMessage {
                role: agent::types::Role::Assistant,
                content: agent::types::ChatMessageContent::AssistantMessageParts(
                    accumulator.into_parts(),
                ),
                attachments: None,
            },
            agent::types::ChatMessage {
                role: agent::types::Role::User,
                content: agent::types::ChatMessageContent::Text(
                    "Based on the information gathered above, produce a structured response \
                     matching the required schema."
                        .to_string(),
                ),
                attachments: None,
            },
        ];

        let model = request
            .model
            .map(str::to_string)
            .unwrap_or_else(|| PredefinedModel::default().to_string());

        let value = agent::structured_output::dynamic_structured_completion(
            model,
            &self.system_prompt,
            to_rig_messages(&conversation),
            DynamicSchema {
                schema: output_schema.clone(),
                name: request.projection_id.to_string(),
                description: None,
            },
            self.tool_context.recorder.as_ref(),
            UsageContext::new(AiFeature::AiProjection, user_id.clone().into_owned()),
        )
        .await
        .map_err(|e| AiProjectionError::Generation(e.to_string()))?;

        serde_json::to_string(&value).map_err(|e| AiProjectionError::Generation(e.to_string()))
    }
}

impl ProjectionGenerator for AgentProjectionGenerator {
    #[tracing::instrument(
        skip(self, request),
        fields(
            user_id = %user_id.as_ref(),
            projection_id = %request.projection_id,
            model = ?request.model,
            structured = request.output_schema.is_some(),
        ),
        err
    )]
    async fn generate(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: GenerationRequest<'_>,
    ) -> Result<String, AiProjectionError> {
        let accumulator = self.run_agent_loop(user_id, &request).await?;

        if request.output_schema.is_some() {
            return self.structured_result(user_id, &request, accumulator).await;
        }

        // Free-text projection: concatenate the loop's text content.
        let text: String = accumulator
            .into_parts()
            .into_iter()
            .filter_map(|part| match part {
                agent::types::AssistantMessagePart::Text { text } => Some(text),
                _ => None,
            })
            .collect();

        Ok(text.trim().to_string())
    }
}
