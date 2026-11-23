//! HTTP representations of usage. Keep existing token fields compatible while
//! the domain represents billing units with enums.

use crate::domain::{self, AiFeature, ModelPricing, UsageAmount};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::Serialize;
use utoipa::ToSchema;

/// Rates applied to an invocation and its resolved dollar cost.
#[derive(Serialize, ToSchema)]
pub struct Price {
    /// Price per million input tokens (USD); zero for audio and credit billing.
    pub price_per_million_in: f32,
    /// Price per million output tokens (USD); zero for audio and credit billing.
    pub price_per_million_out: f32,
    /// Price per million cache-read input tokens (USD), absent when the model
    /// has no published rate and for audio and credit billing.
    pub price_per_million_cache_read: Option<f32>,
    /// Price per million cache-write input tokens (USD), absent when the model
    /// has no published rate and for audio and credit billing.
    pub price_per_million_cache_write: Option<f32>,
    /// Price per audio minute (USD), absent for token and credit billing.
    pub price_per_audio_minute: Option<f32>,
    /// Price per vendor credit (USD), absent for token and audio billing.
    pub price_per_provider_credit: Option<f32>,
    /// Total cost (USD).
    pub total: f32,
}

impl From<domain::Price> for Price {
    fn from(price: domain::Price) -> Self {
        let (input, output, cache_read, cache_write, audio, credit) = match price.pricing {
            ModelPricing::Tokens {
                input,
                output,
                cache_read,
                cache_write,
            } => (input, output, cache_read, cache_write, None, None),
            ModelPricing::Audio { per_minute } => (0.0, 0.0, None, None, Some(per_minute), None),
            ModelPricing::ProviderCredits { per_credit } => {
                (0.0, 0.0, None, None, None, Some(per_credit))
            }
        };
        Self {
            price_per_million_in: input,
            price_per_million_out: output,
            price_per_million_cache_read: cache_read,
            price_per_million_cache_write: cache_write,
            price_per_audio_minute: audio,
            price_per_provider_credit: credit,
            total: price.total,
        }
    }
}

/// Measured usage for one invocation.
#[derive(Serialize, ToSchema)]
pub struct Usage {
    /// Uncached input tokens; zero for audio and credit billing.
    pub input_tokens: u64,
    /// Output tokens; zero for audio and credit billing.
    pub output_tokens: u64,
    /// Input tokens read from a prompt cache; zero for audio and credit billing.
    pub cache_read_input_tokens: u64,
    /// Input tokens written to a prompt cache; zero for audio and credit billing.
    pub cache_write_input_tokens: u64,
    /// Audio duration in seconds, absent for token and credit billing.
    pub audio_seconds: Option<f64>,
    /// Vendor credits consumed, absent for token and audio billing.
    pub provider_credits: Option<u64>,
    /// Provider model identifier.
    pub model: String,
    /// Applied pricing, if known.
    pub price: Option<Price>,
    /// Recording timestamp.
    pub created_at: DateTime<Utc>,
}

impl From<domain::Usage> for Usage {
    fn from(usage: domain::Usage) -> Self {
        let (
            input_tokens,
            output_tokens,
            cache_read_input_tokens,
            cache_write_input_tokens,
            audio,
            credits,
        ) = match usage.amount {
            UsageAmount::Tokens {
                input,
                output,
                cache_read,
                cache_write,
            } => (input, output, cache_read, cache_write, None, None),
            UsageAmount::Audio { duration } => (0, 0, 0, 0, Some(duration.as_secs_f64()), None),
            UsageAmount::ProviderCredits { credits } => (0, 0, 0, 0, None, Some(credits)),
        };
        Self {
            input_tokens,
            output_tokens,
            cache_read_input_tokens,
            cache_write_input_tokens,
            audio_seconds: audio,
            provider_credits: credits,
            model: usage.model,
            price: usage.price.map(Into::into),
            created_at: usage.created_at,
        }
    }
}

/// User and feature attribution for one invocation.
#[derive(Serialize, ToSchema)]
pub struct CompletionUsage {
    /// Feature that performed the invocation.
    pub feature: AiFeature,
    /// User the invocation was performed for.
    pub user: MacroUserIdStr<'static>,
    /// Related entity, if any.
    pub entity: Option<Uuid>,
    /// Measured usage and resolved cost.
    pub cost: Usage,
}

/// Recorded invocations and total for one feature.
#[derive(Serialize, ToSchema)]
pub struct FeatureUsage {
    /// Feature attribution.
    pub feature: AiFeature,
    /// Recorded invocations.
    pub entries: Vec<CompletionUsage>,
    /// Total cost (USD).
    pub total: f32,
}

/// Per-feature breakdown and grand total.
#[derive(Serialize, ToSchema)]
pub struct UsageSummary {
    /// Per-feature usage.
    pub entries: Vec<FeatureUsage>,
    /// Grand total (USD).
    pub total: f32,
}

impl From<domain::UsageSummary> for UsageSummary {
    fn from(summary: domain::UsageSummary) -> Self {
        Self {
            entries: summary
                .entries
                .into_iter()
                .map(|feature| FeatureUsage {
                    feature: feature.feature,
                    entries: feature
                        .entries
                        .into_iter()
                        .map(|entry| CompletionUsage {
                            feature: entry.feature,
                            user: entry.user,
                            entity: entry.entity,
                            cost: entry.cost.into(),
                        })
                        .collect(),
                    total: feature.total,
                })
                .collect(),
            total: summary.total,
        }
    }
}

#[cfg(test)]
mod test;
