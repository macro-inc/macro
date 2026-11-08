//! What routine suggestions need from outside: storage, and what the person's
//! accounts say about their work.

use std::future::Future;

use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::Serialize;
use serde_json::Value;

use super::model::{
    CheckedSuggestion, GenerationOutcome, RoutineSuggestion, StoredGeneration, SuggestionPick,
};

/// Each person's suggestions and the generation that made them.
pub trait SuggestionRepo: Send + Sync + 'static {
    /// The person's last generation, if any.
    fn generation(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<StoredGeneration>>> + Send;

    /// Record that the person read their suggestions at `now`, so the
    /// scheduler keeps generating them; a first read leaves a pending
    /// generation for it to run.
    fn seen(
        &self,
        user: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Up to `limit` people who read their suggestions since
    /// `active_since` and weren't looked at since `checked_before`, those
    /// looked at longest ago first, marked looked at `now`. Concurrent
    /// sweeps take different people.
    fn take_checks(
        &self,
        active_since: DateTime<Utc>,
        checked_before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send;

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

/// The model that picks suggestions: one completion, no tools, answered in
/// `schema`'s shape. Usage is the person's, metered as non-billable.
pub trait SuggestionModel: Send + Sync + 'static {
    /// The answer, or none when the model failed or gave no usable JSON.
    fn complete(
        &self,
        user: &MacroUserIdStr<'static>,
        instructions: &str,
        prompt: &str,
        schema: &Value,
    ) -> impl Future<Output = Option<Value>> + Send;
}

/// Generating suggestions, for whatever triggers it: the scheduler's sweep,
/// and one day a routine.
pub trait GenerateSuggestions: Send + Sync + 'static {
    /// Generate the person's suggestions now and wait for them, unless the
    /// flag is off or a generation is already running.
    fn generate_for(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<GenerationOutcome>> + Send;
}

/// Routine suggestions as the API serves them.
pub trait RoutineSuggestionApi: Send + Sync + 'static {
    /// The person's stored suggestions. Reading never generates; it marks
    /// the person active, so the scheduler generates for them.
    fn suggestions(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<super::model::RoutineSuggestions>> + Send;

    /// Start a generation now in the background, unless one is running:
    /// the person asked, as onboarding does once their inbox is connected.
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
