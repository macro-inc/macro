//! Per-provider-call pricing for speed tiers and long-context requests.

use super::{MeteringError, ModelSpeed};
use ai_usage::financial::{ProviderModel, UsageEvidence};
use ai_usage::{UsageAmount, UsageContext, UsageRecorder};
use serde_json::Value;
use std::sync::Arc;

#[derive(Clone)]
pub(super) struct PerCallUsage {
    recorder: Arc<dyn UsageRecorder>,
    usage: UsageContext,
    model: String,
    requested: ModelSpeed,
}

impl PerCallUsage {
    pub(super) fn new(
        recorder: Arc<dyn UsageRecorder>,
        usage: UsageContext,
        model: &str,
        requested: ModelSpeed,
    ) -> Self {
        Self {
            recorder,
            usage,
            model: model.to_owned(),
            requested,
        }
    }

    pub(super) fn matches(&self, model: &ProviderModel, body: &Value) -> bool {
        self.model == format!("{}/{}", model.provider(), model.model())
            && match self.requested {
                ModelSpeed::Standard => {
                    body.get("speed").is_none()
                        && body
                            .get("service_tier")
                            .is_none_or(|tier| tier == "default")
                }
                ModelSpeed::Fast => body.get("speed").is_some_and(|speed| speed == "fast"),
                ModelSpeed::Ultrafast => body
                    .get("service_tier")
                    .is_some_and(|tier| tier == "ultrafast"),
            }
    }

    pub(super) fn record(
        &self,
        evidence: UsageEvidence,
        delivered: Option<&str>,
    ) -> Result<(), MeteringError> {
        let UsageEvidence::Reported(tokens) = evidence else {
            return Ok(());
        };
        let speed = match delivered {
            Some("default" | "standard") => ModelSpeed::Standard,
            Some("fast") if self.model.starts_with("anthropic/") => ModelSpeed::Fast,
            Some("ultrafast") if self.model.starts_with("openai/") => ModelSpeed::Ultrafast,
            None if self.requested == ModelSpeed::Standard => ModelSpeed::Standard,
            _ => {
                tracing::error!(model = %self.model, "provider did not report a supported billing speed");
                return Err(MeteringError::Unsupported);
            }
        };
        if !speed.supported(&self.model) {
            return Err(MeteringError::Unsupported);
        }
        let bare = self
            .model
            .split_once('/')
            .ok_or(MeteringError::Unsupported)?
            .1;
        let mut price_key = bare.to_owned();
        match speed {
            ModelSpeed::Standard => {}
            ModelSpeed::Fast => price_key.push_str(":fast"),
            ModelSpeed::Ultrafast => price_key.push_str(":ultrafast"),
        }
        // OpenAI's threshold uses inclusive prompt tokens, per call, not the sum
        // of all prompts in a tool loop. Reasoning is billed as output once.
        if self.model.starts_with("openai/")
            && tokens
                .input()
                .saturating_add(tokens.cache_read())
                .saturating_add(tokens.cache_write())
                > 272_000
        {
            price_key.push_str(":long");
        }
        self.recorder.record(self.usage.clone().into_event(
            price_key,
            UsageAmount::Tokens {
                input: tokens.input(),
                output: tokens.output() + tokens.reasoning(),
                cache_read: tokens.cache_read(),
                cache_write: tokens.cache_write(),
            },
        ));
        Ok(())
    }
}

#[cfg(test)]
mod test;
