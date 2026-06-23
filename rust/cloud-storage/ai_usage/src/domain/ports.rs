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
}

/// Resolved price for one completion.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Price {
    /// Price per million input tokens (USD).
    pub price_per_million_in: f32,
    /// Price per million output tokens (USD).
    pub price_per_million_out: f32,
    /// Total cost of the completion (USD).
    pub total: f32,
}

impl Price {
    /// Compute the price of a completion from per-million rates and token counts.
    pub fn compute(price_per_million_in: f32, price_per_million_out: f32, usage: &Usage) -> Self {
        let total = (usage.input_tokens as f32 / 1_000_000.0) * price_per_million_in
            + (usage.output_tokens as f32 / 1_000_000.0) * price_per_million_out;
        Self {
            price_per_million_in,
            price_per_million_out,
            total,
        }
    }
}

/// The token usage and resolved cost of a single completion.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Usage {
    /// Tokens consumed by the input.
    pub input_tokens: u32,
    /// Tokens generated in the output.
    pub output_tokens: u32,
    /// The model api id (e.g. `claude-opus-4-8`).
    pub model: String,
    /// Resolved price, or `None` when the model had no pricing at record time.
    pub price: Option<Price>,
    /// When the completion was recorded.
    pub created_at: DateTime<Utc>,
}

/// A recorded completion: who, what feature, optional entity, and the cost.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct CompletionUsage {
    /// The feature that performed the completion.
    pub feature: AiFeature,
    /// The user the completion was performed for (the [system user](SYSTEM_USER_ID)
    /// for background work).
    pub user: MacroUserIdStr<'static>,
    /// The entity the completion related to, if any.
    pub entity: Option<Uuid>,
    /// Token usage and cost.
    pub cost: Usage,
}

/// Usage for a single feature, with its rolled-up dollar total.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FeatureUsage {
    /// The feature.
    pub feature: AiFeature,
    /// The individual completions recorded for this feature.
    pub entries: Vec<CompletionUsage>,
    /// Total cost across `entries` (USD).
    pub total: f32,
}

/// The result of a usage query: per-feature breakdown plus a grand total.
#[derive(Debug, Clone, Serialize, ToSchema)]
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

/// A usage event handed to a [`UsageRecorder`] by the agent crate. The recorder
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
    /// Input tokens for this round-trip.
    pub input_tokens: u64,
    /// Output tokens for this round-trip.
    pub output_tokens: u64,
}

/// The constant attributes of a logical completion (everything except the model
/// and token counts, which are only known once the completion runs).
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
            input_tokens,
            output_tokens,
        }
    }
}

/// Errors raised by the cost crate.
#[derive(Debug, Error)]
pub enum UsageError {
    /// A database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// Any other error.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Convenience result alias for the crate.
pub type Result<T> = std::result::Result<T, UsageError>;

/// Outbound storage port.
pub trait UsageRepo: Send + Sync + 'static {
    /// Persist a fully-priced completion row.
    // TODO: Consumers should have an easier call to make than this
    // A consumer shouldn't have to know the pricing of the model the just need to supply (feature, input tokens, output tokens, model name)
    fn insert_usage(&self, usage: &CompletionUsage) -> impl Future<Output = Result<()>> + Send;

    /// Fetch the current per-million `(input, output)` rates for a model, if any.
    fn get_pricing(&self, model: &str) -> impl Future<Output = Result<Option<(f32, f32)>>> + Send;

    /// Upsert the pricing for a model and recompute the `total` of every
    /// existing `ai_usage` row for that model.
    fn set_pricing(
        &self,
        model: &str,
        price_per_million_in: f32,
        price_per_million_out: f32,
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
#[cfg(test)]
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpUsageRecorder;

#[cfg(test)]
impl UsageRecorder for NoOpUsageRecorder {
    fn record(&self, _event: UsageEvent) {}
}

/// The admin-facing query / pricing port, implemented by the domain service and
/// consumed by the inbound axum router.
pub trait UsageService: Send + Sync + 'static {
    /// Summarize recorded usage matching `params`.
    fn get_usage(
        &self,
        params: UsageApiParams,
    ) -> impl Future<Output = Result<UsageSummary>> + Send;

    /// Set the pricing for a model and recompute all of its recorded rows.
    fn set_pricing(
        &self,
        model: String,
        price_per_million_in: f32,
        price_per_million_out: f32,
    ) -> impl Future<Output = Result<()>> + Send;
}
