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
    /// Price per million input tokens (USD); zero for audio billing.
    pub price_per_million_in: f32,
    /// Price per million output tokens (USD); zero for audio billing.
    pub price_per_million_out: f32,
    /// Price per audio minute (USD), absent for token billing.
    pub price_per_audio_minute: Option<f32>,
    /// Total cost (USD).
    pub total: f32,
}

impl From<domain::Price> for Price {
    fn from(price: domain::Price) -> Self {
        let (input, output, audio) = match price.pricing {
            ModelPricing::Tokens { input, output } => (input, output, None),
            ModelPricing::Audio { per_minute } => (0.0, 0.0, Some(per_minute)),
        };
        Self {
            price_per_million_in: input,
            price_per_million_out: output,
            price_per_audio_minute: audio,
            total: price.total,
        }
    }
}

/// Measured usage for one invocation.
#[derive(Serialize, ToSchema)]
pub struct Usage {
    /// Input tokens; zero for audio billing.
    pub input_tokens: u64,
    /// Output tokens; zero for audio billing.
    pub output_tokens: u64,
    /// Audio duration in seconds, absent for token billing.
    pub audio_seconds: Option<f64>,
    /// Provider model identifier.
    pub model: String,
    /// Applied pricing, if known.
    pub price: Option<Price>,
    /// Recording timestamp.
    pub created_at: DateTime<Utc>,
}

impl From<domain::Usage> for Usage {
    fn from(usage: domain::Usage) -> Self {
        let (input_tokens, output_tokens, audio_seconds) = match usage.amount {
            UsageAmount::Tokens { input, output } => (input, output, None),
            UsageAmount::Audio { duration } => (0, 0, Some(duration.as_secs_f64())),
        };
        Self {
            input_tokens,
            output_tokens,
            audio_seconds,
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
