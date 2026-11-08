//! Normalize a provider's reported token usage into the disjoint billing
//! dimensions of [`UsageAmount::Tokens`].
//!
//! rig fills [`Usage`] with each provider's own counters, and the providers
//! disagree on whether input includes cache traffic.

use ai_usage::UsageAmount;
use rig_core::completion::Usage;

use super::metering::WireProtocol;

#[cfg(test)]
mod test;

/// The billable token amount of one completion reported over `protocol`.
pub(crate) fn usage_amount(protocol: WireProtocol, usage: &Usage) -> UsageAmount {
    let cache_read = usage.cached_input_tokens;
    let cache_write = usage.cache_creation_input_tokens;
    match protocol {
        // Anthropic input already excludes cache reads and writes, and its
        // output already counts thinking.
        WireProtocol::Anthropic => UsageAmount::Tokens {
            input: usage.input_tokens,
            output: usage.output_tokens,
            cache_read,
            cache_write,
        },
        // OpenAI-style input includes cached tokens; output includes reasoning.
        WireProtocol::Responses | WireProtocol::ChatCompletions => UsageAmount::Tokens {
            input: uncached_input(protocol, usage),
            output: usage.output_tokens,
            cache_read,
            cache_write,
        },
        // Gemini's prompt count includes cached content, and its candidates
        // exclude thoughts, which bill at the output rate.
        WireProtocol::Gemini => UsageAmount::Tokens {
            input: uncached_input(protocol, usage),
            output: usage.output_tokens + usage.reasoning_tokens,
            cache_read,
            cache_write,
        },
    }
}

/// Input that includes cache traffic, minus that traffic.
fn uncached_input(protocol: WireProtocol, usage: &Usage) -> u64 {
    let cached = usage.cached_input_tokens + usage.cache_creation_input_tokens;
    usage.input_tokens.checked_sub(cached).unwrap_or_else(|| {
        tracing::warn!(
            ?protocol,
            input_tokens = usage.input_tokens,
            cache_read = usage.cached_input_tokens,
            cache_write = usage.cache_creation_input_tokens,
            "provider reported more cached than total input tokens"
        );
        0
    })
}
