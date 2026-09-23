//! Cost model types and the ports the crate is built around.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use thiserror::Error;
use utoipa::ToSchema;

/// The reserved system user recorded for completions with no originating
/// end-user (background tasks, internal summarization, subagents, …).
///
/// Building a [`MacroUserIdStr`] parses the id at runtime (there is no
/// `const fn` constructor), so this is a `LazyLock` rather than a literal
/// `const`. Deref yields a `&'static MacroUserIdStr`; clone it when an owned
/// value is needed.
pub static SYSTEM_USER_ID: LazyLock<MacroUserIdStr<'static>> = LazyLock::new(|| {
    MacroUserIdStr::try_from("macro|ai-system@macro.com".to_string())
        .expect("system user id is valid")
});

/// Everything we use AI for. The wire / DB form of each variant is its
/// `snake_case` name.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AiFeature {
    /// Interactive chat.
    Chat,
    /// User memory generation.
    Memory,
    /// Scheduled actions / automations.
    Automation,
    /// The dynamic (structured) completions API.
    DynamicCompletionsApi,
    /// Automatic chat renaming.
    ChatRename,
    /// Call recording summarization.
    CallSummary,
    /// Channel bots.
    ChannelBot,
    /// AI projection materialization.
    AiProjection,
    /// In-document AI editing (the ai-editing-worker).
    AiEditing,
    /// Import pipeline agent sessions (connector gathers + Notion imports).
    Import,
    /// In-process ACP agent sessions (the in-memory harness).
    AgentSession,
    /// Choosing the repository an agent session's first prompt belongs to.
    AgentRepositoryChoice,
    /// User-confirmed audio transcription.
    Dictation,
}

/// The billable quantity for one AI invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageAmount {
    /// Token-based inference.
    Tokens {
        /// Tokens consumed by the input.
        input: u64,
        /// Tokens generated in the output.
        output: u64,
    },
    /// Duration-based audio inference.
    Audio {
        /// Provider-reported duration of the audio.
        duration: std::time::Duration,
    },
}

/// Rates for a model's billing unit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ModelPricing {
    /// Prices per million input/output tokens (USD).
    Tokens {
        /// Input token rate.
        input: f32,
        /// Output token rate.
        output: f32,
    },
    /// Price per minute of audio (USD).
    Audio {
        /// Audio minute rate.
        per_minute: f32,
    },
}

impl ModelPricing {
    /// Reject invalid prices before changing stored pricing or usage totals.
    pub fn validate(self) -> Result<Self> {
        let valid = |rate: f32| rate.is_finite() && rate >= 0.0;
        let is_valid = match self {
            Self::Tokens { input, output } => valid(input) && valid(output),
            Self::Audio { per_minute } => valid(per_minute),
        };
        if is_valid {
            Ok(self)
        } else {
            Err(UsageError::InvalidPricing)
        }
    }
}

/// Resolved price for one AI call, including the rates applied at record time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Price {
    /// Rates matching the usage's billing unit.
    pub pricing: ModelPricing,
    /// Total cost (USD).
    pub total: f32,
}

impl Price {
    /// Compute cost only when the rate and usage use the same billing unit.
    pub fn compute(pricing: ModelPricing, amount: UsageAmount) -> Option<Self> {
        let total = match (pricing, amount) {
            (
                ModelPricing::Tokens { input, output },
                UsageAmount::Tokens {
                    input: input_tokens,
                    output: output_tokens,
                },
            ) => {
                input_tokens as f64 / 1_000_000.0 * f64::from(input)
                    + output_tokens as f64 / 1_000_000.0 * f64::from(output)
            }
            (ModelPricing::Audio { per_minute }, UsageAmount::Audio { duration }) => {
                duration.as_secs_f64() / 60.0 * f64::from(per_minute)
            }
            _ => return None,
        };
        Some(Self {
            pricing,
            total: total as f32,
        })
    }
}

/// The measured usage and resolved cost of a single AI call.
#[derive(Debug, Clone)]
pub struct Usage {
    /// The invocation's billable quantity.
    pub amount: UsageAmount,
    /// The model api id (e.g. `claude-opus-4-8`).
    pub model: String,
    /// Resolved price, or `None` when compatible pricing was unavailable.
    pub price: Option<Price>,
    /// When the call was recorded.
    pub created_at: DateTime<Utc>,
}

/// A recorded completion: who, what feature, optional entity, and the cost.
#[derive(Debug, Clone)]
pub struct CompletionUsage {
    /// The feature that performed the completion.
    pub feature: AiFeature,
    /// The user the completion was performed for (the [system user](SYSTEM_USER_ID)
    /// for background work).
    pub user: MacroUserIdStr<'static>,
    /// The entity the completion related to, if any.
    pub entity: Option<Uuid>,
    /// Token/audio usage and cost.
    pub cost: Usage,
}

/// Usage for a single feature, with its rolled-up dollar total.
#[derive(Debug, Clone)]
pub struct FeatureUsage {
    /// The feature.
    pub feature: AiFeature,
    /// The individual completions recorded for this feature.
    pub entries: Vec<CompletionUsage>,
    /// Total cost across `entries` (USD).
    pub total: f32,
}

/// The result of a usage query: per-feature breakdown plus a grand total.
#[derive(Debug, Clone)]
pub struct UsageSummary {
    /// Per-feature usage.
    pub entries: Vec<FeatureUsage>,
    /// Grand total cost across all features (USD).
    pub total: f32,
}

/// Parameters for [`UsageService::get_usage`].
#[derive(Debug, Clone, Default)]
pub struct UsageApiParams {
    /// Inclusive lower bound on `created_at`.
    pub from: Option<DateTime<Utc>>,
    /// Exclusive upper bound on `created_at`.
    pub until: Option<DateTime<Utc>>,
    /// If empty, include all users.
    pub include_users: Vec<MacroUserIdStr<'static>>,
    /// If empty, include all features.
    pub features: Vec<AiFeature>,
}

/// A usage event handed to a [`UsageRecorder`] by an AI caller. The recorder
/// resolves pricing and persists it; callers never see the cost.
#[derive(Debug, Clone)]
pub struct UsageEvent {
    /// The feature that performed the completion.
    pub feature: AiFeature,
    /// The user the completion was performed for.
    pub user: MacroUserIdStr<'static>,
    /// The entity the completion related to, if any.
    pub entity: Option<Uuid>,
    /// The model api id.
    pub model: String,
    /// The invocation's billable quantity.
    pub amount: UsageAmount,
}

/// The constant attributes of a logical completion (everything except the model
/// and measured usage, which are only known once the invocation runs).
///
/// Threaded into agent functions so each call site declares which feature it is
/// and who it is for.
#[derive(Debug, Clone)]
pub struct UsageContext {
    /// The feature performing the completion.
    pub feature: AiFeature,
    /// The user the completion is for.
    pub user: MacroUserIdStr<'static>,
    /// The entity the completion relates to, if any.
    pub entity: Option<Uuid>,
}

impl UsageContext {
    /// A context for a user-attributed completion.
    pub fn new(feature: AiFeature, user: MacroUserIdStr<'static>) -> Self {
        Self {
            feature,
            user,
            entity: None,
        }
    }

    /// A context for background/internal work with no originating end-user.
    pub fn system(feature: AiFeature) -> Self {
        Self {
            feature,
            user: SYSTEM_USER_ID.clone(),
            entity: None,
        }
    }

    /// Set the related entity.
    pub fn with_entity(mut self, entity: Option<Uuid>) -> Self {
        self.entity = entity;
        self
    }

    /// Build a [`UsageEvent`] from this context plus a completion's model and
    /// token counts.
    pub fn into_event(self, model: String, input_tokens: u64, output_tokens: u64) -> UsageEvent {
        UsageEvent {
            feature: self.feature,
            user: self.user,
            entity: self.entity,
            model,
            amount: UsageAmount::Tokens {
                input: input_tokens,
                output: output_tokens,
            },
        }
    }

    /// Build a duration-based event without representing audio as tokens.
    pub fn into_audio_event(self, model: String, duration: std::time::Duration) -> UsageEvent {
        UsageEvent {
            feature: self.feature,
            user: self.user,
            entity: self.entity,
            model,
            amount: UsageAmount::Audio { duration },
        }
    }
}

/// Errors raised by the cost crate.
#[derive(Debug, Error)]
pub enum UsageError {
    /// The actor cannot administer AI usage or pricing.
    #[error("admin access required")]
    Forbidden,
    /// A rate was negative or non-finite.
    #[error("prices must be finite and non-negative")]
    InvalidPricing,
    /// A database error.
    #[error("database error: {0}")]
    Db(rootcause::Report),
    /// Any other error.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Convenience result alias for the crate.
pub type Result<T> = std::result::Result<T, UsageError>;

/// Outbound storage port.
pub trait UsageRepo: Send + Sync + 'static {
    /// Persist a fully-priced completion row.
    fn insert_usage(&self, usage: &CompletionUsage) -> impl Future<Output = Result<()>> + Send;

    /// Fetch the current rate for a model's billing unit, if any.
    fn get_pricing(&self, model: &str)
    -> impl Future<Output = Result<Option<ModelPricing>>> + Send;

    /// Upsert the pricing for a model and recompute the `total` of every
    /// existing `ai_usage` row for that model.
    fn set_pricing(
        &self,
        model: &str,
        pricing: ModelPricing,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Query recorded completions matching `params`.
    fn query_usage(
        &self,
        params: &UsageApiParams,
    ) -> impl Future<Output = Result<Vec<CompletionUsage>>> + Send;
}

/// The recording port used by the agent crate. Recording is best-effort: a
/// failure must never propagate into the originating call, so the method is
/// infallible and fire-and-forget.
pub trait UsageRecorder: Send + Sync {
    /// Record one completion round-trip.
    fn record(&self, event: UsageEvent);
}

/// A [`UsageRecorder`] that drops every event. Used at call sites that cannot
/// (or should not) record, mirroring the `NoOp*` adapters used elsewhere.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpUsageRecorder;

impl UsageRecorder for NoOpUsageRecorder {
    fn record(&self, _event: UsageEvent) {}
}

/// The admin-facing query / pricing port, implemented by the domain service and
/// consumed by the inbound axum router.
pub trait UsageService: Send + Sync + 'static {
    /// Summarize recorded usage matching `params`.
    fn get_usage(
        &self,
        actor: MacroUserIdStr<'static>,
        params: UsageApiParams,
    ) -> impl Future<Output = Result<UsageSummary>> + Send;

    /// Set the pricing for a model and recompute all of its recorded rows.
    fn set_pricing(
        &self,
        actor: MacroUserIdStr<'static>,
        model: String,
        pricing: ModelPricing,
    ) -> impl Future<Output = Result<()>> + Send;
}
