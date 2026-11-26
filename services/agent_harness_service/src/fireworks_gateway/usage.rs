//! Token usage and the response id read from Chat Completions responses as
//! they pass through. Only `id` and `usage` are parsed; content is never
//! inspected.

use std::num::NonZeroUsize;

use ai_usage::UsageAmount;
#[cfg(test)]
use ai_usage::financial::{TrustedTokenUsage, UnresolvedReason, UsageEvidence};
use serde::Deserialize;
use sse_core::{SseDecoder, SseEvent};

#[cfg(test)]
mod test;

/// Largest SSE event decoded; a larger one is content and is skipped.
const MAX_EVENT_BYTES: NonZeroUsize = match NonZeroUsize::new(1024 * 1024) {
    Some(limit) => limit,
    None => panic!("the event limit is a non-zero literal"),
};
/// The data of the stream's last event.
const DONE: &str = "[DONE]";

#[derive(Deserialize)]
struct WirePromptDetails {
    cached_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct WireUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    prompt_tokens_details: Option<WirePromptDetails>,
}

#[cfg(test)]
impl WireUsage {
    fn evidence(&self) -> UsageEvidence {
        let (Some(input), Some(output)) = (self.prompt_tokens, self.completion_tokens) else {
            return UsageEvidence::Missing(UnresolvedReason::UsageNotReported);
        };
        let cached = self
            .prompt_tokens_details
            .as_ref()
            .and_then(|details| details.cached_tokens)
            .unwrap_or_default();
        TrustedTokenUsage::from_inclusive_totals(input, output, cached, 0, 0).map_or(
            UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions),
            UsageEvidence::Reported,
        )
    }
}

/// A completion, or one chunk of a streamed one.
#[derive(Deserialize)]
struct WireCompletion {
    id: Option<String>,
    usage: Option<WireUsage>,
}

/// One completion's tokens, in the disjoint billing dimensions.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct TokenUsage {
    pub(super) input: u64,
    pub(super) output: u64,
    pub(super) cache_read: u64,
}

impl TokenUsage {
    /// OpenAI-style prompt tokens include the cached ones.
    fn from_wire(usage: WireUsage) -> Self {
        let prompt = usage.prompt_tokens.unwrap_or_default();
        let cached = usage
            .prompt_tokens_details
            .and_then(|details| details.cached_tokens)
            .unwrap_or_default()
            .min(prompt);
        Self {
            input: prompt - cached,
            output: usage.completion_tokens.unwrap_or_default(),
            cache_read: cached,
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub(super) fn amount(&self) -> UsageAmount {
        UsageAmount::Tokens {
            input: self.input,
            output: self.output,
            cache_read: self.cache_read,
            cache_write: 0,
        }
    }
}

/// What a response said about itself.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct Observed {
    pub(super) id: Option<String>,
    pub(super) usage: TokenUsage,
}

impl Observed {
    fn apply(&mut self, completion: WireCompletion) {
        if self.id.is_none() {
            self.id = completion.id;
        }
        if let Some(usage) = completion.usage {
            self.usage = TokenUsage::from_wire(usage);
        }
    }
}

/// The id and usage of a non-streaming response body.
pub(super) fn from_json_body(body: &[u8]) -> Observed {
    let mut observed = Observed::default();
    if let Ok(completion) = serde_json::from_slice::<WireCompletion>(body) {
        observed.apply(completion);
    }
    observed
}

/// Accumulates the id and usage of an SSE byte stream split at arbitrary
/// points. With `stream_options.include_usage`, the last chunk before
/// `[DONE]` carries the usage.
#[derive(Debug)]
pub(crate) struct SseUsage {
    observed: Observed,
    decoder: SseDecoder,
    #[cfg(test)]
    usage: UsageEvidence,
    #[cfg(test)]
    evidence: Option<UsageEvidence>,
}

impl Default for SseUsage {
    fn default() -> Self {
        Self {
            observed: Observed::default(),
            decoder: SseDecoder::with_limit(MAX_EVENT_BYTES),
            #[cfg(test)]
            usage: UsageEvidence::Missing(UnresolvedReason::UsageNotReported),
            #[cfg(test)]
            evidence: None,
        }
    }
}

impl SseUsage {
    pub(crate) fn observe(&mut self, mut chunk: &[u8]) {
        while let Some(event) = self.decoder.next(&mut chunk) {
            let Ok(SseEvent::Message(message)) = event else {
                continue;
            };
            if message.data == DONE {
                #[cfg(test)]
                {
                    self.evidence.get_or_insert(self.usage);
                }
                continue;
            }
            match serde_json::from_str::<WireCompletion>(&message.data) {
                Ok(completion) => {
                    #[cfg(test)]
                    if let Some(usage) = &completion.usage {
                        self.usage = usage.evidence();
                    }
                    self.observed.apply(completion);
                }
                Err(error) => {
                    tracing::warn!(category = ?error.classify(), "unreadable fireworks stream chunk");
                }
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn evidence(&self) -> Option<UsageEvidence> {
        self.evidence
    }

    pub(super) fn observed(&self) -> &Observed {
        &self.observed
    }
}
