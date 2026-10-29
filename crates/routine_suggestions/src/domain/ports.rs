//! Ports the suggestion service depends on.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::model::{InboxMessage, RoutineSuggestion, StoredSuggestionSet};

/// Errors the suggestion service surfaces.
#[derive(Debug, thiserror::Error)]
pub enum RoutineSuggestionError {
    /// Anything that failed underneath.
    #[error("routine suggestions failed: {0}")]
    Internal(rootcause::Report),
}

/// Storage for each user's suggestion set.
pub trait RoutineSuggestionRepo: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The user's stored set, if a generation ever started for them.
    fn get(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<StoredSuggestionSet>, Self::Err>> + Send;

    /// Marks the user's set as generating under `generation_id`, keeping its
    /// current suggestions, unless another generation that started after
    /// `reclaim_before` is still running. Returns whether this call claimed
    /// it.
    fn claim(
        &self,
        user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
        now: DateTime<Utc>,
        reclaim_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Stores `suggestions` as ready if `generation_id` still owns the set.
    /// Returns whether it did.
    fn complete(
        &self,
        user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
        suggestions: &[RoutineSuggestion],
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Marks the set failed, keeping its suggestions, if `generation_id`
    /// still owns it.
    fn fail(
        &self,
        user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The top of a user's inboxes.
pub trait InboxReader: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Up to `limit` of the newest messages across the user's own inboxes,
    /// newest first. A user without a connected inbox has none.
    fn recent_messages(
        &self,
        user: &MacroUserIdStr<'static>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<InboxMessage>, Self::Err>> + Send;
}

/// A model that answers in JSON.
pub trait SuggestionGenerator: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Answers `user_prompt` under `system_prompt` with JSON matching
    /// `schema`, metering the call to `user`.
    fn generate(
        &self,
        user: &MacroUserIdStr<'static>,
        system_prompt: &str,
        user_prompt: String,
        schema: serde_json::Value,
    ) -> impl Future<Output = Result<serde_json::Value, Self::Err>> + Send;
}
