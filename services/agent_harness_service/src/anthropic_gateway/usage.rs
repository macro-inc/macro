//! Token usage read from Anthropic Messages responses as they pass through.
//!
//! Only the `usage` objects are parsed; content is never inspected. The
//! `anthropic` crate's `Usage` requires `input_tokens`, which `message_delta`
//! omits, so the counters here are all optional.

use std::num::NonZeroUsize;

use ai_usage::UsageAmount;
#[cfg(test)]
use ai_usage::financial::{TrustedTokenUsage, UnresolvedReason, UsageEvidence};
use serde::Deserialize;
use sse_core::{SseDecoder, SseEvent};

#[cfg(test)]
mod test;

/// Largest SSE event decoded. Usage events are small; anything larger is
/// content and is skipped.
const MAX_EVENT_BYTES: NonZeroUsize = match NonZeroUsize::new(1024 * 1024) {
    Some(limit) => limit,
    None => panic!("the event limit is a non-zero literal"),
};
const MESSAGE_START: &str = "message_start";
const MESSAGE_DELTA: &str = "message_delta";
const MESSAGE_STOP: &str = "message_stop";

#[derive(Debug, Default, Deserialize)]
struct WireUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct WireMessage {
    usage: Option<WireUsage>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WireEvent {
    MessageStart { message: WireMessage },
    MessageDelta { usage: Option<WireUsage> },
}

/// The four disjoint token counters of one Messages response.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct TokenUsage {
    pub(super) input: u64,
    pub(super) output: u64,
    pub(super) cache_read: u64,
    pub(super) cache_write: u64,
}

impl TokenUsage {
    /// Apply a usage object. Anthropic's counters are cumulative, so a later
    /// value replaces an earlier one and an absent one keeps it.
    fn apply(&mut self, usage: WireUsage) {
        if let Some(input) = usage.input_tokens {
            self.input = input;
        }
        if let Some(output) = usage.output_tokens {
            self.output = output;
        }
        if let Some(cache_read) = usage.cache_read_input_tokens {
            self.cache_read = cache_read;
        }
        if let Some(cache_write) = usage.cache_creation_input_tokens {
            self.cache_write = cache_write;
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
            cache_write: self.cache_write,
        }
    }
}

/// Usage of a non-streaming response body, if it carries any.
pub(super) fn from_json_body(body: &[u8]) -> Option<TokenUsage> {
    let message: WireMessage = serde_json::from_slice(body).ok()?;
    let mut usage = TokenUsage::default();
    usage.apply(message.usage?);
    Some(usage)
}

/// Accumulates usage from an SSE byte stream split at arbitrary points.
#[derive(Debug)]
pub(crate) struct SseUsage {
    usage: TokenUsage,
    decoder: SseDecoder,
    /// Whether the message ended: `message_stop` came. A stream that ends
    /// without it (an `error` event after the 200, a cut connection) did not
    /// finish.
    stopped: bool,
    #[cfg(test)]
    reported: [bool; 2],
    #[cfg(test)]
    evidence: Option<UsageEvidence>,
}

impl Default for SseUsage {
    fn default() -> Self {
        Self {
            usage: TokenUsage::default(),
            decoder: SseDecoder::with_limit(MAX_EVENT_BYTES),
            stopped: false,
            #[cfg(test)]
            reported: [false; 2],
            #[cfg(test)]
            evidence: None,
        }
    }
}

impl SseUsage {
    pub(crate) fn observe(&mut self, mut chunk: &[u8]) {
        while let Some(event) = self.decoder.next(&mut chunk) {
            // An oversized event is content; the decoder skips it.
            let Ok(SseEvent::Message(message)) = event else {
                continue;
            };
            if message.event == MESSAGE_STOP {
                #[cfg(test)]
                if !self.stopped {
                    self.evidence = Some(self.usage_evidence());
                }
                self.stopped = true;
                continue;
            }
            if message.event != MESSAGE_START && message.event != MESSAGE_DELTA {
                continue;
            }
            match serde_json::from_str::<WireEvent>(&message.data) {
                Ok(WireEvent::MessageStart { message }) => {
                    if let Some(usage) = message.usage {
                        self.apply(usage);
                    }
                }
                Ok(WireEvent::MessageDelta { usage: Some(usage) }) => self.apply(usage),
                Ok(WireEvent::MessageDelta { usage: None }) => {}
                Err(error) => {
                    tracing::warn!(category = ?error.classify(), event = %message.event, "unreadable anthropic usage event");
                }
            }
        }
    }

    fn apply(&mut self, usage: WireUsage) {
        #[cfg(test)]
        {
            self.reported[0] |= usage.input_tokens.is_some();
            self.reported[1] |= usage.output_tokens.is_some();
        }
        self.usage.apply(usage);
    }

    #[cfg(test)]
    fn usage_evidence(&self) -> UsageEvidence {
        let usage = self.usage;
        if self.reported == [true; 2] {
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(
                usage.input,
                usage.output,
                usage.cache_read,
                usage.cache_write,
                0,
            ))
        } else {
            UsageEvidence::Missing(UnresolvedReason::UsageNotReported)
        }
    }

    #[cfg(test)]
    pub(crate) fn evidence(&self) -> Option<UsageEvidence> {
        self.evidence
    }

    pub(super) fn usage(&self) -> TokenUsage {
        self.usage
    }

    /// Whether the streamed message finished.
    pub(super) fn stopped(&self) -> bool {
        self.stopped
    }
}
