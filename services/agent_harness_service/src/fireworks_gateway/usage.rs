//! Token usage and the response id read from Chat Completions responses as
//! they pass through. Only `id` and `usage` are parsed; content is never
//! inspected.

use std::num::NonZeroUsize;

use ai_usage::UsageAmount;
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
pub(super) struct SseUsage {
    observed: Observed,
    decoder: SseDecoder,
}

impl Default for SseUsage {
    fn default() -> Self {
        Self {
            observed: Observed::default(),
            decoder: SseDecoder::with_limit(MAX_EVENT_BYTES),
        }
    }
}

impl SseUsage {
    pub(super) fn observe(&mut self, mut chunk: &[u8]) {
        while let Some(event) = self.decoder.next(&mut chunk) {
            let Ok(SseEvent::Message(message)) = event else {
                continue;
            };
            if message.data == DONE {
                continue;
            }
            match serde_json::from_str::<WireCompletion>(&message.data) {
                Ok(completion) => self.observed.apply(completion),
                Err(error) => {
                    tracing::warn!(error = ?error, "unreadable fireworks stream chunk");
                }
            }
        }
    }

    pub(super) fn observed(&self) -> &Observed {
        &self.observed
    }
}
