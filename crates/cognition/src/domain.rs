//! Tool-free generation and classification for an authenticated user.

use async_trait::async_trait;
pub use jev::domain::{DecisionRequest, DecisionResponse};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(test)]
mod test;

/// Maximum combined UTF-8 size of prompt and additional instructions.
pub const MAX_PROMPT_BYTES: usize = 64 * 1024;
/// Maximum compact JSON size of the requested output schema.
pub const MAX_SCHEMA_BYTES: usize = 16 * 1024;

/// A provider-qualified model identifier; entitlement is checked by cognition.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(try_from = "String", into = "String")]
#[schemars(with = "String")]
pub struct ModelId(String);

impl ModelId {
    /// The original provider/model identifier, without normalization.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ModelId {
    type Error = CognitionError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let valid_parts = value
            .split_once('/')
            .is_some_and(|(provider, model)| !provider.is_empty() && !model.is_empty());
        if value.len() > 200 || value.chars().any(char::is_whitespace) || !valid_parts {
            return Err(CognitionError::InvalidInput(
                "Use a provider/model identifier, or omit model to use the default.",
            ));
        }
        Ok(Self(value))
    }
}

impl From<ModelId> for String {
    fn from(value: ModelId) -> Self {
        value.0
    }
}

/// Generate structured data from supplied context, without running any tools.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GenerateObjectRequest {
    /// Instructions and source context; combined with system, at most 64 KiB.
    pub prompt: String,
    /// Additional instructions for this completion, not a tool or identity policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    /// Optional provider/model identifier. Omit to use the shared default model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelId>,
    /// JSON Schema for an object result; at most 16 KiB of compact JSON.
    pub schema: Value,
}

impl GenerateObjectRequest {
    /// Check the bounded request before contacting a provider-backed service.
    pub fn validate(&self) -> Result<(), Report> {
        if self.prompt.trim().is_empty()
            || self.prompt.len() + self.system.as_deref().map_or(0, str::len) > MAX_PROMPT_BYTES
        {
            return Err(CognitionError::InvalidInput(
                "Provide a nonempty prompt; prompt and system together must fit in 64 KiB.",
            )
            .into());
        }
        if !self.schema.is_object()
            || self.schema["type"] != "object"
            || serde_json::to_vec(&self.schema)?.len() > MAX_SCHEMA_BYTES
        {
            return Err(CognitionError::InvalidInput(
                "Schema must describe an object root and fit in 16 KiB.",
            )
            .into());
        }
        Ok(())
    }
}

/// Structured output returned by the shared cognition service.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub struct GenerateObjectResponse {
    /// Generated object, validated against the requested schema by cognition.
    pub object: Value,
}

/// Shared AI operations. The caller supplies its authenticated acting user.
#[async_trait]
pub trait Cognition: Send + Sync + 'static {
    /// Generate from supplied context only; never discover or execute tools.
    async fn generate_object(
        &self,
        user: &MacroUserIdStr<'static>,
        request: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report>;

    /// Estimate named yes/no probabilities through the shared Jev endpoint.
    async fn decide(
        &self,
        user: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report>;
}

/// Safe failures exposed by shared cognition capabilities.
#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum CognitionError {
    /// A request failed bounded syntax validation before provider work.
    #[error("{0}")]
    InvalidInput(&'static str),
    /// No service was composed for this host.
    #[error("AI generation and decisions are not configured on this host.")]
    Unavailable,
    /// The trusted credentials were rejected; retrying unchanged will not help.
    #[error("Cognition could not authenticate this request. Check the service configuration.")]
    Unauthenticated,
    /// The acting user may not use the requested model or capability.
    #[error("The user cannot access this model or capability. Omit model to use the default.")]
    Forbidden,
    /// The service declined new billed work.
    #[error("The user's AI allowance is exhausted; no completion was started.")]
    AllowanceExceeded,
    /// The service rejected the supplied syntax or schema.
    #[error("Cognition rejected the request. Check the prompt, schema, and decision questions.")]
    Rejected,
    /// A request exceeded the service's body limit.
    #[error("Cognition rejected the request size. Reduce the input or schema.")]
    RequestTooLarge,
    /// Temporary rate limiting or overload.
    #[error("Cognition is busy or unavailable. Try again later.")]
    Busy,
    /// The service did not answer within the complete request deadline.
    #[error(
        "Cognition timed out. Reduce the work before retrying; dispatched AI usage may still be recorded."
    )]
    Timeout,
    /// The service returned a malformed, interrupted, or unexpected response.
    #[error(
        "Cognition returned an invalid or interrupted response. No generated result is available."
    )]
    InvalidResponse,
    /// A complete response cannot fit the configured reply budget.
    #[error("The cognition response is too large. Request a smaller output.")]
    ResponseTooLarge,
}
