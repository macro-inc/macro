//! Per-request financial context, separate from GenAI telemetry and analytics.
//!
//! Hosts select the mode from trusted policy facts and scope the entire operation
//! (including structured-output parsing). Unscoped calls retain legacy behavior;
//! they are NOT covered producers and must not be activated by a host. Spawned
//! tasks must explicitly carry the scope; the agent stream driver does so.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use ai_usage::financial::{
    BeginInvocation, FinalizeInvocation, FinancialCapability, FinancialError, FinancialMode,
    InvocationId, ProviderModel, ProviderOutcome, ProviderRequestId, RunId, TrustedTokenUsage,
    UnresolvedReason, UsageEvidence, WriteDisposition,
};
use ai_usage::{FinancialUsage, UsageContext};
use chrono::Utc;
use serde_json::Value;

#[cfg(test)]
mod test;

tokio::task_local! {
    static REQUEST: MeteringContext;
}

/// Provider wire semantics, not the provider's commercial identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireProtocol {
    /// Native Anthropic Messages.
    Anthropic,
    /// OpenAI Responses.
    Responses,
    /// A reviewed OpenAI-compatible Chat Completions provider.
    ChatCompletions,
    /// Native Gemini GenerateContent.
    Gemini,
}

/// A host-reviewed activation gate for one exact provider/API model.
///
/// Do not populate this from user input or analytics pricing. The host must verify
/// token-only pricing, usage semantics (including omitted optional counters), and
/// the provider-enforced input/context ceiling. Multimodal pricing, server tools,
/// cache TTL variants and unbounded execution require separate review. No built-in
/// profiles are enabled by this crate; missing support fails before network I/O.
#[derive(Debug, Clone)]
pub struct ProviderSupport {
    /// Exact wire model, including account prefixes for compatible providers.
    pub model: ProviderModel,
    /// Verified wire protocol.
    pub protocol: WireProtocol,
    /// Provider-enforced upper bound for every input/cache dimension.
    pub input_token_ceiling: u64,
    /// Maximum generated tokens, enforced on the outgoing request.
    pub output_token_ceiling: u64,
    /// Some compatible endpoints report an all-zero sentinel rather than usage.
    pub zero_usage_is_missing: bool,
}

impl ProviderSupport {
    pub(crate) fn constrain(&self, body: &mut Value) -> Result<TrustedTokenUsage, MeteringError> {
        if self.input_token_ceiling == 0 || self.output_token_ceiling == 0 {
            return Err(MeteringError::Unsupported);
        }
        if unsupported_content(body)
            || body.get("prediction").is_some()
            || body
                .get("service_tier")
                .is_some_and(|tier| tier != "default")
            || body.get("speed").is_some()
            || body.get("n").is_some_and(|n| n.as_u64() != Some(1))
            || body
                .pointer("/generationConfig/candidateCount")
                .is_some_and(|n| n.as_u64() != Some(1))
        {
            return Err(MeteringError::Unsupported);
        }
        // Built-in provider tools can have non-token charges. Only client-side
        // function tools belong to these profiles.
        if let Some(tools) = body.get("tools").and_then(Value::as_array) {
            for tool in tools {
                let supported = match self.protocol {
                    WireProtocol::Anthropic => tool.get("type").is_none_or(|t| t == "custom"),
                    WireProtocol::Responses | WireProtocol::ChatCompletions => {
                        tool.get("type").is_some_and(|t| t == "function")
                    }
                    WireProtocol::Gemini => tool.as_object().is_some_and(|t| {
                        t.get("functionDeclarations").is_some_and(Value::is_array)
                            && t.iter().all(|(key, value)| {
                                key == "functionDeclarations" || value.is_null()
                            })
                    }),
                };
                if !supported {
                    return Err(MeteringError::Unsupported);
                }
            }
        }
        // Rig 0.41 ignores generic max_tokens when Gemini generation_config is
        // absent. Install the verified ceiling on the actual wire request.
        if self.protocol == WireProtocol::Gemini {
            let object = body.as_object_mut().ok_or(MeteringError::Unsupported)?;
            let config = object
                .entry("generationConfig")
                .or_insert_with(|| serde_json::json!({}));
            if config.is_null() {
                *config = serde_json::json!({});
            }
            config
                .as_object_mut()
                .ok_or(MeteringError::Unsupported)?
                .entry("maxOutputTokens")
                .or_insert(Value::from(self.output_token_ceiling));
        }
        let pointer = match self.protocol {
            WireProtocol::Anthropic => "/max_tokens",
            WireProtocol::Responses => "/max_output_tokens",
            WireProtocol::ChatCompletions if body.get("max_completion_tokens").is_some() => {
                "/max_completion_tokens"
            }
            WireProtocol::ChatCompletions => "/max_tokens",
            WireProtocol::Gemini => "/generationConfig/maxOutputTokens",
        };
        let limit = body
            .pointer_mut(pointer)
            .ok_or(MeteringError::Unsupported)?;
        let output = limit
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or(MeteringError::Unsupported)?
            .min(self.output_token_ceiling);
        *limit = Value::from(output);
        if body
            .pointer("/thinking/budget_tokens")
            .and_then(Value::as_u64)
            .is_some_and(|thinking| thinking >= output)
        {
            return Err(MeteringError::Unsupported);
        }
        // Reserve conservative independent maxima. Actual normalized counters are
        // disjoint; unused capacity is released by the funding owner, not here.
        Ok(TrustedTokenUsage::from_disjoint(
            self.input_token_ceiling,
            output,
            self.input_token_ceiling,
            self.input_token_ceiling,
            output,
        ))
    }
}

/// Multimodal and alternate-TTL requests require different rate provenance.
/// Inspect content envelopes, not user text, function arguments or tool schemas.
fn unsupported_content(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(unsupported_content),
        Value::Object(object) => {
            if matches!(
                object.get("type").and_then(Value::as_str),
                Some(
                    "image"
                        | "image_url"
                        | "input_image"
                        | "document"
                        | "input_file"
                        | "audio"
                        | "input_audio"
                )
            ) || object.contains_key("inlineData")
                || object.contains_key("fileData")
                || value
                    .pointer("/cache_control/ttl")
                    .is_some_and(|ttl| ttl != "5m")
            {
                return true;
            }
            [
                "messages",
                "contents",
                "content",
                "parts",
                "system",
                "systemInstruction",
            ]
            .into_iter()
            .any(|key| object.get(key).is_some_and(unsupported_content))
                || (object.get("type").is_none()
                    && object.get("input").is_some_and(unsupported_content))
        }
        _ => false,
    }
}

/// Immutable attribution and capability for one logical run. Clones share only a
/// fail-closed latch, never mutable payer/model attribution on a shared router.
#[derive(Clone)]
pub struct MeteringContext {
    run_id: RunId,
    mode: FinancialMode,
    capability: FinancialCapability,
    usage: UsageContext,
    support: Arc<Vec<ProviderSupport>>,
    stopped: Arc<AtomicBool>,
}

impl MeteringContext {
    /// Bind trusted attribution and activation facts before entering an AI call.
    pub fn new(
        mode: FinancialMode,
        capability: FinancialCapability,
        usage: UsageContext,
        support: Vec<ProviderSupport>,
    ) -> Self {
        Self {
            run_id: RunId::new(),
            mode,
            capability,
            usage,
            support: Arc::new(support),
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Run a completion, structured generation or session operation in this scope.
    /// This does not automatically propagate into arbitrary `tokio::spawn` calls.
    pub async fn scope<F: Future>(&self, future: F) -> F::Output {
        REQUEST.scope(self.clone(), future).await
    }

    pub(crate) fn require_usage(usage: &UsageContext) -> Result<(), MeteringError> {
        if let Some(context) = Self::current().filter(Self::activated) {
            context.capability.for_mode(context.mode)?;
            if context.usage.user != usage.user
                || context.usage.feature != usage.feature
                || context.usage.entity != usage.entity
            {
                return Err(MeteringError::AttributionMismatch);
            }
        }
        Ok(())
    }

    pub(crate) fn current() -> Option<Self> {
        REQUEST.try_with(Clone::clone).ok()
    }

    pub(crate) async fn carry<F: Future>(context: Option<Self>, future: F) -> F::Output {
        match context {
            Some(context) => context.scope(future).await,
            None => future.await,
        }
    }

    pub(crate) fn activated(&self) -> bool {
        self.mode == FinancialMode::Activated
    }

    pub(crate) async fn begin(
        &self,
        model: ProviderModel,
        protocol: WireProtocol,
        body: &mut Value,
    ) -> Result<Attempt, MeteringError> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(MeteringError::Stopped);
        }
        self.capability.for_mode(self.mode)?;
        let FinancialCapability::Available(service) = &self.capability else {
            return Err(FinancialError::CapabilityUnavailable.into());
        };
        let support = self
            .support
            .iter()
            .find(|p| p.model == model && p.protocol == protocol)
            .ok_or(MeteringError::Unsupported)?
            .clone();
        let token_budget = support.constrain(body)?;
        let request = BeginInvocation {
            run_id: self.run_id,
            invocation_id: InvocationId::new(),
            user: self.usage.user.clone(),
            feature: self.usage.feature,
            entity: self.usage.entity,
            model,
            occurred_at: Utc::now(),
            token_budget,
        };
        let result = service.begin(request.clone()).await;
        let admission = result.inspect_err(|_| self.stopped.store(true, Ordering::Release))?;
        if admission.disposition != WriteDisposition::Inserted {
            self.stopped.store(true, Ordering::Release);
            return Err(MeteringError::Replayed);
        }
        request.check_replay(&admission.value.request)?;
        admission.value.rate.require_model(&request.model)?;
        if admission.value.funding.invocation_id != request.invocation_id
            || admission.value.rate.tokens.price(token_budget)?
                > admission.value.funding.maximum_public_usage
        {
            self.stopped.store(true, Ordering::Release);
            return Err(MeteringError::Unsupported);
        }
        Ok(Attempt {
            id: request.invocation_id,
            service: service.clone(),
            context: self.clone(),
            support,
        })
    }
}

pub(crate) struct Attempt {
    pub(crate) id: InvocationId,
    service: Arc<dyn FinancialUsage>,
    context: MeteringContext,
    pub(crate) support: ProviderSupport,
}

impl Attempt {
    /// Spawn before awaiting so cancellation of the consumer cannot cancel delivery
    /// of evidence already observed. Delivery retries reuse the entire immutable
    /// value; HTTP executions always obtain a fresh invocation ID instead.
    pub(crate) async fn finish(
        self,
        outcome: ProviderOutcome,
        usage: UsageEvidence,
        provider_request_id: Option<ProviderRequestId>,
    ) -> Result<(), MeteringError> {
        if matches!(
            usage,
            UsageEvidence::Missing(
                UnresolvedReason::UnsupportedDimensions | UnresolvedReason::UsageNotReported
            )
        ) {
            self.context.stopped.store(true, Ordering::Release);
        }
        let evidence = FinalizeInvocation {
            invocation_id: self.id,
            occurred_at: Utc::now(),
            provider_request_id,
            outcome,
            usage,
        };
        tokio::spawn(async move {
            for retry in 0..3 {
                match self.service.finalize(evidence.clone()).await {
                    Ok(_) => return Ok(()),
                    Err(error) => {
                        tracing::error!(invocation_id = ?self.id, error = ?error, "financial evidence delivery failed");
                        if retry == 2 {
                            self.context.stopped.store(true, Ordering::Release);
                            return Err(MeteringError::Financial(error));
                        }
                    }
                }
            }
            unreachable!("bounded delivery loop always returns")
        }).await.map_err(|_| MeteringError::Stopped)?
    }
}

/// Financial failures must propagate, unlike best-effort analytics failures.
#[derive(Debug, thiserror::Error)]
pub enum MeteringError {
    /// Failure from the financial domain, including exhausted funding.
    #[error(transparent)]
    Financial(#[from] FinancialError),
    /// Missing reviewed provider semantics or an enforceable execution budget.
    #[error("provider usage or execution budget support is not verified")]
    Unsupported,
    /// A previous admission may already have executed; never execute it again.
    #[error("replayed financial admission cannot execute the provider again")]
    Replayed,
    /// A previous financial failure prevents further attempts in this run.
    #[error("financial run stopped")]
    Stopped,
    /// The caller's attribution does not match the immutable financial scope.
    #[error("financial request attribution mismatch")]
    AttributionMismatch,
}
