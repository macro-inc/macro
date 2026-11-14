//! List prices for estimating what a session costs before, or without, its own
//! records reporting a total. A model missing from the table is unpriced, never
//! free.
//!
//! Prices are first-party API list rates in US dollars per million tokens, at
//! the standard tier, as published on 2026-11-13:
//!
//! - Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>
//! - OpenAI: <https://developers.openai.com/api/docs/pricing>
//!
//! Check both pages when a provider ships a model, and add its row here.

#[cfg(test)]
mod test;

use crate::domain::model::{Cost, Tokens};

const TOKENS_PER_PRICE_UNIT: f64 = 1_000_000.0;

/// What one million tokens of each class cost.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rates {
    /// Uncached input.
    pub input: f64,
    /// Output.
    pub output: f64,
    /// Prompt-cache reads.
    pub cache_read: f64,
    /// Prompt-cache writes with the short lifetime (Anthropic five minutes,
    /// OpenAI thirty minutes).
    pub cache_write: f64,
    /// Prompt-cache writes with the long lifetime (Anthropic one hour).
    pub cache_write_long: f64,
}

/// A model's rates, and the higher rates a long prompt pays instead.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Price {
    /// Rates for a prompt up to the long-context threshold.
    pub base: Rates,
    /// Prompts over this many input tokens (cached or not) pay `long` for the
    /// whole request.
    pub long_context: Option<(u64, Rates)>,
}

impl Price {
    /// The rates one response pays, chosen by the size of its prompt.
    fn rates_for(&self, tokens: Tokens) -> Rates {
        let prompt = tokens.input + tokens.cache_read + tokens.cache_write;
        match self.long_context {
            Some((threshold, long)) if prompt > threshold => long,
            _ => self.base,
        }
    }
}

/// Anthropic rates: five-minute writes cost 1.25x input and one-hour writes
/// 2x; `cache_read` is per model.
const fn anthropic(input: f64, output: f64, cache_read: f64) -> Rates {
    Rates {
        input,
        output,
        cache_read,
        cache_write: input * 1.25,
        cache_write_long: input * 2.0,
    }
}

/// OpenAI rates: thirty-minute writes cost 1.25x input. Its twelve-hour
/// writes are not reported separately in rollouts, so they never apply.
const fn openai(input: f64, output: f64, cache_read: f64) -> Rates {
    Rates {
        input,
        output,
        cache_read,
        cache_write: input * 1.25,
        cache_write_long: input * 2.5,
    }
}

const fn flat(base: Rates) -> Price {
    Price {
        base,
        long_context: None,
    }
}

const fn tiered(base: Rates, threshold: u64, long: Rates) -> Price {
    Price {
        base,
        long_context: Some((threshold, long)),
    }
}

/// Model ids and their prices.
const PRICES: &[(&str, Price)] = &[
    ("claude-fable-5-2", flat(anthropic(8.0, 40.0, 0.20))),
    ("claude-fable-5-1", flat(anthropic(10.0, 50.0, 0.25))),
    ("claude-fable-5", flat(anthropic(10.0, 50.0, 1.0))),
    ("claude-opus-5-5", flat(anthropic(4.0, 20.0, 0.20))),
    ("claude-opus-5", flat(anthropic(5.0, 25.0, 0.50))),
    ("claude-opus-4-8", flat(anthropic(5.0, 25.0, 0.50))),
    ("claude-opus-4-7", flat(anthropic(5.0, 25.0, 0.50))),
    ("claude-opus-4-6", flat(anthropic(5.0, 25.0, 0.50))),
    ("claude-opus-4-5", flat(anthropic(5.0, 25.0, 0.50))),
    ("claude-sonnet-5-5", flat(anthropic(2.0, 10.0, 0.10))),
    ("claude-sonnet-5", flat(anthropic(2.0, 10.0, 0.20))),
    ("claude-sonnet-4-6", flat(anthropic(3.0, 15.0, 0.30))),
    ("claude-sonnet-4-5", flat(anthropic(3.0, 15.0, 0.30))),
    (
        "claude-haiku-5-5",
        tiered(
            anthropic(0.10, 0.50, 0.01),
            100_000,
            anthropic(0.50, 2.50, 0.05),
        ),
    ),
    ("claude-haiku-4-5", flat(anthropic(1.0, 5.0, 0.10))),
    (
        "gpt-6-astra",
        tiered(openai(10.0, 50.0, 1.0), 272_000, openai(20.0, 75.0, 2.0)),
    ),
    (
        "gpt-6.1-sol",
        tiered(openai(2.0, 10.0, 0.10), 272_000, openai(4.0, 15.0, 0.20)),
    ),
    (
        "gpt-6.1-terra",
        tiered(openai(1.0, 5.0, 0.05), 272_000, openai(2.0, 7.5, 0.10)),
    ),
    (
        "gpt-6-sol",
        tiered(openai(2.0, 10.0, 0.20), 272_000, openai(4.0, 15.0, 0.40)),
    ),
    (
        "gpt-6-luna",
        tiered(openai(0.10, 0.50, 0.01), 272_000, openai(0.20, 0.75, 0.02)),
    ),
];

/// Length of the date some providers append to a model id (`-20251001`).
const DATE_SUFFIX_DIGITS: usize = 8;

/// The price of a model, if the table has it. Matches the id exactly, after
/// dropping a context-size tag (`claude-opus-5-5[1m]`) and a dated snapshot
/// suffix (`claude-haiku-4-5-20251001`).
pub fn price(model: &str) -> Option<Price> {
    let model = model.split('[').next().unwrap_or(model);
    PRICES
        .iter()
        .find(|(id, _)| is_snapshot_of(model, id))
        .map(|(_, price)| *price)
}

fn is_snapshot_of(model: &str, id: &str) -> bool {
    let Some(rest) = model.strip_prefix(id) else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }

    rest.strip_prefix('-').is_some_and(|date| {
        date.len() == DATE_SUFFIX_DIGITS && date.bytes().all(|byte| byte.is_ascii_digit())
    })
}

/// The estimated cost of one model response: [`Cost::Estimated`] when the
/// model is priced, [`Cost::Unpriced`] otherwise.
pub fn estimate(model: Option<&str>, tokens: Tokens) -> Cost {
    let Some(price) = model.and_then(price) else {
        return Cost::Unpriced;
    };

    let rates = price.rates_for(tokens);
    let long_writes = tokens.cache_write_1h.min(tokens.cache_write);
    let short_writes = tokens.cache_write - long_writes;
    let usd = (tokens.input as f64 * rates.input
        + tokens.output as f64 * rates.output
        + tokens.cache_read as f64 * rates.cache_read
        + short_writes as f64 * rates.cache_write
        + long_writes as f64 * rates.cache_write_long)
        / TOKENS_PER_PRICE_UNIT;
    Cost::Estimated(usd)
}
