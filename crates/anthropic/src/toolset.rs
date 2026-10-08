mod bash_code_execution;
#[cfg(test)]
mod test;
mod text_editor_code_execution;
mod web_fetch;
mod web_search;

pub use bash_code_execution::BashCodeExecution;
pub use text_editor_code_execution::TextEditorCodeExecution;
pub use web_fetch::WebFetch;
pub use web_search::WebSearch;

use crate::client::Client;
use crate::types::request::{
    CreateMessageRequestBody, RequestContent, RequestMessage, Role, ServerTool, SystemPrompt, Tool,
};
use crate::types::response::{Content, MessageResponse, ResponseContentKind};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use ai_usage::financial::{
    FinalizeInvocation, InvocationId, ProviderModel, ProviderOutcome, ProviderRequestId, RunId,
    TrustedTokenUsage, UnresolvedReason, UsageEvidence,
};
use ai_usage::{TrackedInvocation, UsageContext, UsageRecorder};
use chrono::Utc;
use std::sync::Arc;

/// Service context for Anthropic server tools.
pub struct AnthropicToolContext {
    /// The Anthropic API client.
    pub client: Arc<Client>,
    /// The model to use for server tool invocations.
    pub model: String,
    /// Admission for the authenticated caller before any provider execution.
    pub admission: Arc<dyn ai_billing::domain::admission::AiAdmissionService>,
    /// Analytics injection also exposes the separate observational journal.
    pub recorder: Arc<dyn UsageRecorder>,
    /// Inherited feature/entity only; each call replaces the user from RequestContext.
    pub usage_context: UsageContext,
}

impl Clone for AnthropicToolContext {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
            model: self.model.clone(),
            admission: self.admission.clone(),
            recorder: self.recorder.clone(),
            usage_context: self.usage_context.clone(),
        }
    }
}

impl AnthropicToolContext {
    /// Create a new context from a client and model name.
    pub fn new(client: Client, model: String) -> Self {
        Self {
            client: Arc::new(client),
            model,
            admission: Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
            recorder: Arc::new(ai_usage::NoOpUsageRecorder),
            usage_context: UsageContext::system(ai_usage::AiFeature::Chat),
        }
    }
}

fn tool_error(error: impl Into<anyhow::Error>) -> ToolCallError {
    let error = error.into();
    ToolCallError {
        description: format!("Anthropic API error: {error:?}"),
        internal_error: error,
    }
}

fn response_usage(value: &serde_json::Value) -> UsageEvidence {
    let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) else {
        return UsageEvidence::Missing(UnresolvedReason::UsageNotReported);
    };
    let tokens = (|| {
        let optional = |key| match usage.get(key) {
            None | Some(serde_json::Value::Null) => Some(0),
            Some(value) => value.as_u64(),
        };
        if let Some(cache) = usage.get("cache_creation").filter(|cache| !cache.is_null()) {
            let cache = cache.as_object()?;
            if cache
                .get("ephemeral_1h_input_tokens")
                .is_some_and(|value| !value.is_null() && value.as_u64() != Some(0))
            {
                return None;
            }
        }
        Some(TrustedTokenUsage::from_disjoint(
            usage.get("input_tokens")?.as_u64()?,
            usage.get("output_tokens")?.as_u64()?,
            optional("cache_read_input_tokens")?,
            optional("cache_creation_input_tokens")?,
            0, // Anthropic output already includes thinking.
        ))
    })();
    tokens
        .map(UsageEvidence::Reported)
        .unwrap_or(UsageEvidence::Missing(
            UnresolvedReason::UnsupportedDimensions,
        ))
}

/// Create the Anthropic server tools toolset.
pub fn anthropic_toolset() -> AsyncToolCollection<AnthropicToolContext> {
    AsyncToolCollection::new()
        .add_tool::<WebSearch, AnthropicToolContext>()
        .add_tool::<WebFetch, AnthropicToolContext>()
        .add_tool::<BashCodeExecution, AnthropicToolContext>()
        .add_tool::<TextEditorCodeExecution, AnthropicToolContext>()
}

pub(crate) async fn invoke_server_tool(
    context: &AnthropicToolContext,
    request_context: &RequestContext,
    server_tool: ServerTool,
    input: &str,
) -> Result<Vec<ResponseContentKind>, ToolCallError> {
    context
        .admission
        .admit(&request_context.user_id, context.usage_context.feature)
        .await
        .map_err(|error| ToolCallError {
            description: format!("{}: {error}", error.code()),
            internal_error: error.into(),
        })?;

    let request = CreateMessageRequestBody {
        model: context.model.clone(),
        messages: vec![RequestMessage {
            role: Role::User,
            content: RequestContent::Text(input.to_string()),
        }],
        max_tokens: 16000,
        tools: Some(vec![Tool::Server(server_tool)]),
        system: Some(SystemPrompt::Text(
            "Use the provided tool to fulfill the user's request.".into(),
        )),
        ..Default::default()
    };

    let client = context.client.clone();
    let (tracking, model) = match (
        context.recorder.tracking(),
        ProviderModel::new("anthropic", &context.model),
    ) {
        (Some(tracking), Ok(model)) => (tracking, model),
        (_, model) => {
            let _ = model.inspect_err(|error| {
                tracing::error!(error = ?error, "cannot identify tool provider; observation not persisted");
            });
            let response = client.chat().create(request).await.map_err(tool_error)?;
            return Ok(match response.content {
                Some(Content::Array(blocks)) => blocks,
                _ => Vec::new(),
            });
        }
    };
    let attribution = TrackedInvocation {
        run_id: RunId::new(),
        invocation_id: InvocationId::new(),
        user: request_context.user_id.clone(),
        feature: context.usage_context.feature,
        entity: context.usage_context.entity,
        model,
        occurred_at: Utc::now(),
    };
    let _ = tracking.begin(attribution.clone()).await.inspect_err(|error| {
        tracing::error!(error = ?error, invocation_id = ?attribution.invocation_id, "tool observation begin failed");
    });
    // The client performs one HTTP execution, with no hidden retries. Keep it
    // alive after tool cancellation so already-incurred usage can be recorded.
    let (caller_alive, cancelled) = tokio::sync::oneshot::channel::<()>();
    let response = tokio::spawn(async move {
        let request = crate::types::request::transform_request_web_fetch(request);
        let execution = async {
            let response = client.post_response("/v1/messages", request).await?;
            let status = response.status();
            let request_id = response
                .headers()
                .get("request-id")
                .and_then(|id| id.to_str().ok())
                .and_then(|id| ProviderRequestId::new(id).ok());
            let value = response.json::<serde_json::Value>().await?;
            Ok::<_, anyhow::Error>((status, request_id, value))
        };
        tokio::pin!(execution);
        let result = tokio::select! {
            result = &mut execution => result,
            _ = cancelled => match tokio::time::timeout(
                std::time::Duration::from_secs(300), execution
            ).await {
                Ok(result) => result,
                Err(error) => Err(error.into()),
            },
        };
        let (usage, provider_request_id, outcome) = match &result {
            Ok((status, request_id, value)) => {
                let request_id = request_id.clone().or_else(|| {
                    value
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .and_then(|id| ProviderRequestId::new(id).ok())
                });
                let outcome = if status.is_success() {
                    ProviderOutcome::Succeeded
                } else {
                    ProviderOutcome::Failed
                };
                (response_usage(value), request_id, outcome)
            }
            Err(_) => (
                UsageEvidence::Missing(UnresolvedReason::Interrupted),
                None,
                ProviderOutcome::Unknown,
            ),
        };
        let evidence = FinalizeInvocation {
            invocation_id: attribution.invocation_id,
            occurred_at: Utc::now(),
            provider_request_id,
            outcome,
            usage,
        };
        for _ in 0..3 {
            let recorded = match tracking.begin(attribution.clone()).await {
                Ok(_) => tracking.finalize(evidence.clone()).await,
                Err(error) => Err(error),
            };
            if recorded
                .inspect_err(|error| {
                    tracing::error!(
                        error = ?error,
                        invocation_id = ?attribution.invocation_id,
                        "tool observation delivery failed"
                    );
                })
                .is_ok()
            {
                break;
            }
        }
        let (status, _, value) = result?;
        if !status.is_success() {
            let api_error = serde_json::from_value::<crate::prelude::ApiError>(value)?;
            return Err(crate::error::AnthropicError::ApiError {
                api_error,
                status_code: status,
            }
            .into());
        }
        Ok::<_, anyhow::Error>(value)
    })
    .await
    .map_err(tool_error)?
    .map_err(tool_error)?;
    drop(caller_alive);
    // Observe before result parsing: a malformed tool result can still incur tokens.
    let response: MessageResponse = serde_json::from_value(response).map_err(tool_error)?;

    match response.content {
        Some(Content::Array(blocks)) => Ok(blocks),
        _ => Ok(Vec::new()),
    }
}
