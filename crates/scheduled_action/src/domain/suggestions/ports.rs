//! What routine suggestions need from outside: storage, and what the person's
//! accounts say about their work.

use std::future::Future;

use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::Serialize;

use super::model::{CheckedSuggestion, RoutineSuggestion, StoredGeneration, SuggestionPick};

/// Each person's suggestions and the generation that made them.
pub trait SuggestionRepo: Send + Sync + 'static {
    /// The person's last generation, if any.
    fn generation(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<StoredGeneration>>> + Send;

    /// Start `generation_id` for the person unless another generation started
    /// after `reclaim_before` is still running; whether it was started.
    fn claim(
        &self,
        user: &MacroUserIdStr<'_>,
        generation_id: Uuid,
        now: DateTime<Utc>,
        reclaim_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Replace the person's open suggestions with `suggestions`, in order,
    /// if `generation_id` still owns the generation; whether it did.
    /// Dismissed and accepted suggestions stay.
    fn complete(
        &self,
        user: &MacroUserIdStr<'_>,
        generation_id: Uuid,
        inputs: &str,
        suggestions: &[CheckedSuggestion],
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Mark `generation_id` failed, if it still owns the generation.
    fn fail(
        &self,
        user: &MacroUserIdStr<'_>,
        generation_id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The person's suggestions that are neither dismissed nor made into a
    /// routine, best first per surface. `safe_default` is false: the service
    /// sets it from the catalog.
    fn open(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<RoutineSuggestion>>> + Send;

    /// What the person said they're not interested in.
    fn dismissed(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<SuggestionPick>>> + Send;

    /// Mark the person's suggestion `id` not interesting; whether it was
    /// theirs.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// One of the newest messages in an inbox, read from the provider.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InboxMessage {
    /// The sender, as `Name <address>` or the address alone.
    pub from: Option<String>,
    pub subject: Option<String>,
    /// The provider's short preview of the body.
    pub snippet: Option<String>,
    pub received_at: Option<DateTime<Utc>>,
}

/// What the person's accounts say about their work, read when suggestions
/// are generated.
pub trait SuggestionSources: Send + Sync + 'static {
    /// Up to `limit` of the newest messages across the person's own
    /// inboxes, newest first, read from the provider so it works before
    /// their mail has synchronized.
    fn inbox(
        &self,
        user: &MacroUserIdStr<'static>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<InboxMessage>>> + Send;

    /// The ids of the person's connected inboxes, cheap enough to read on
    /// every request, to tell when one is added.
    fn inbox_ids(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<String>>> + Send;

    /// Tools the person uses, detected from their mail, by name.
    fn tools(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<String>>> + Send;
}

/// Routine suggestions as the API serves them.
pub trait RoutineSuggestionApi: Send + Sync + 'static {
    /// The person's suggestions, starting a generation when they are due.
    fn suggestions(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<super::model::RoutineSuggestions>> + Send;

    /// Start a generation now, unless one is running.
    fn refresh(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<super::model::RoutineSuggestions>> + Send;

    /// The person isn't interested in suggestion `id`.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;
}
