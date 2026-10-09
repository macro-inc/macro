//! Bounded, owner-attributed AI generation within a code execution.
use super::ExecutionIdentity;
use ai_billing::domain::admission::AiAdmissionService;
use ai_usage::{AiFeature, UsageAmount, UsageContext, UsageRecorder};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tracing::Instrument;

/// Stable model aliases; provider selection stays on the trusted worker.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum GenerationModel {
    /// Low-latency generation.
    #[default]
    Fast,
    /// Higher-quality generation.
    Good,
}

/// Single-step generation without provider credentials or agent tools.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerationRequest {
    /// Server-owned model alias, default fast.
    #[serde(default)]
    pub model: GenerationModel,
    /// User prompt, bounded together with system to 64 KiB.
    pub prompt: String,
    /// Optional instructions for this call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    /// At most 4096 output tokens; defaults to 1024.
    #[serde(default = "default_output_tokens")]
    pub max_output_tokens: u32,
    /// Restricted JSON Schema for structured generation; see sdk.help('ai').
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
}

fn default_output_tokens() -> u32 {
    1024
}

/// Provider evidence; total input includes the cache dimensions.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerationUsage {
    /// Total provider input tokens.
    pub input_tokens: u64,
    /// Total provider output tokens.
    pub output_tokens: u64,
    /// Cached input already read.
    #[serde(default)]
    pub cache_read_tokens: u64,
    /// Cached input written by this call.
    #[serde(default)]
    pub cache_write_tokens: u64,
}

/// Awaited Vercel AI SDK result, including usage even on structured-output failure.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    /// Generated text.
    pub text: String,
    /// Validated structured output when requested.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object: Option<Value>,
    /// Resolved model identifier.
    pub model: String,
    /// Provider finish reason.
    pub finish_reason: String,
    /// Provider-reported quantities.
    pub usage: GenerationUsage,
    /// Safe failure after a billed provider completion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Provider capability. Implementations do not decide caller admission.
#[async_trait]
pub trait CodeAiProvider: Send + Sync + 'static {
    /// Generate once; no automatic retries.
    async fn generate(&self, request: &GenerationRequest) -> anyhow::Result<GenerationResult>;
}

/// AI use-case policy over replaceable provider, admission and usage ports.
pub struct CodeAiService {
    provider: Arc<dyn CodeAiProvider>,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
    completions: Arc<tokio::sync::Semaphore>,
}

impl CodeAiService {
    /// Wire the host's configured admission and metering capabilities.
    pub fn new(
        provider: Arc<dyn CodeAiProvider>,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
    ) -> Self {
        Self {
            provider,
            admission,
            recorder,
            completions: Arc::new(tokio::sync::Semaphore::new(16)),
        }
    }

    /// Validate and admit as the authenticated session owner, then record usage.
    #[tracing::instrument(skip_all, fields(session_id = %identity.session), err)]
    pub async fn generate(
        &self,
        identity: &ExecutionIdentity,
        request: &GenerationRequest,
        structured: bool,
    ) -> anyhow::Result<GenerationResult> {
        anyhow::ensure!(
            !request.prompt.is_empty()
                && request.prompt.len() + request.system.as_deref().map_or(0, str::len) <= 65_536,
            "Prompt and system must fit in 64 KiB."
        );
        anyhow::ensure!(
            (1..=4096).contains(&request.max_output_tokens),
            "maxOutputTokens must be between 1 and 4096."
        );
        anyhow::ensure!(
            structured == request.schema.is_some(),
            "generateObject requires a schema; generateText does not accept one."
        );
        if let Some(schema) = &request.schema {
            anyhow::ensure!(
                schema.is_object()
                    && schema["type"] == "object"
                    && serde_json::to_vec(schema)?.len() <= 16_384,
                "Schema must describe an object root and fit in 16 KiB."
            );
        }
        let permit = self
            .completions
            .clone()
            .try_acquire_owned()
            .map_err(|_| anyhow::anyhow!("AI generation is busy. Try again later."))?;
        self.admission
            .admit(&identity.owner, AiFeature::AgentSession)
            .await?;
        // Providers can bill a request after Stop. The completion retains its
        // permit and records actual usage even when its caller drops the handle.
        let provider = self.provider.clone();
        let recorder = self.recorder.clone();
        let owner = identity.owner.clone();
        let request = request.clone();
        tokio::spawn(
            async move {
                let _permit = permit;
                let result = tokio::time::timeout(
                    std::time::Duration::from_secs(28),
                    provider.generate(&request),
                )
                .await
                .map_err(|_| anyhow::anyhow!("AI generation timed out."))??;
                let usage = &result.usage;
                recorder.record(
                    UsageContext::new(AiFeature::AgentSession, owner).into_event(
                        result.model.clone(),
                        UsageAmount::Tokens {
                            input: usage
                                .input_tokens
                                .saturating_sub(usage.cache_read_tokens)
                                .saturating_sub(usage.cache_write_tokens),
                            output: usage.output_tokens,
                            cache_read: usage.cache_read_tokens,
                            cache_write: usage.cache_write_tokens,
                        },
                    ),
                );
                anyhow::ensure!(
                    result.error.is_none(),
                    "AI output did not match the requested schema. Increase maxOutputTokens or simplify the schema and prompt."
                );
                Ok(result)
            }
            .instrument(tracing::Span::current()),
        )
        .await
        .map_err(|_| anyhow::anyhow!("AI generation task failed."))?
    }
}

#[cfg(test)]
mod test;
