//! What routine suggestions need from outside: storage, what the person's
//! accounts hold, and the hidden agent sessions that suggest.

use std::future::Future;

use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde::Serialize;

use suggestions::domain::model::GenerationTrigger;

use super::model::{
    CheckedSuggestion, GenerationStatus, RetireSuggestion, RoutineGenerationReport,
    RoutineSuggestions, StoredSuggestion, SuggestOutcome, SuggestRequest, SuggestionReview,
};

/// What AI suggested for each person, and what became of it.
pub trait SuggestionRepo: Send + Sync + 'static {
    /// How many suggestions session `session` handed back and kept.
    fn kept_by(
        &self,
        user: &MacroUserIdStr<'_>,
        session: Uuid,
    ) -> impl Future<Output = Result<u32>> + Send;

    /// Keep `suggestion`, handed back by `session` of `generation` for the
    /// person, with its routine idea when it has one, and log both; its id,
    /// or which ideas limit the idea would pass, keeping nothing.
    fn add(
        &self,
        user: &MacroUserIdStr<'_>,
        session: Uuid,
        generation: Uuid,
        suggestion: &CheckedSuggestion,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Kept>> + Send;

    /// Retire the person's open suggestion `id` and its routine idea for
    /// `reason`, logged as `session` of `generation`'s; whether it was open.
    fn retire(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        session: Uuid,
        generation: Uuid,
        reason: &str,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Every suggestion AI made for the person, dismissed and retired ones
    /// too.
    fn suggestions(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<StoredSuggestion>>> + Send;

    /// Catalog routines the person dismissed as Macro's templates, by key.
    fn dismissed_templates(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<String>>> + Send;

    /// Dismiss the person's suggestion `id` and its routine idea for good;
    /// whether it was theirs.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Dismiss catalog routine `key` as a template for the person, for good.
    fn dismiss_template(
        &self,
        user: &MacroUserIdStr<'_>,
        key: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The suggestions the person's routines were saved from.
    fn saved_from(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Uuid>>> + Send;
}

/// One of the newest messages in an inbox, read from the provider.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InboxMessage {
    /// The sender, as `Name <address>` or the address alone.
    pub from: Option<String>,
    /// The recipients, likewise.
    pub to: Vec<String>,
    pub subject: Option<String>,
    /// The provider's labels or folders.
    pub labels: Vec<String>,
    /// The provider's short preview of the body.
    pub snippet: Option<String>,
    pub received_at: Option<DateTime<Utc>>,
}

/// What the person's accounts hold, read when suggestions are generated.
pub trait SuggestionSources: Send + Sync + 'static {
    /// Up to `limit` of the newest messages across the person's own
    /// inboxes, newest first, read from the provider so it works before
    /// their mail has synchronized.
    fn inbox(
        &self,
        user: &MacroUserIdStr<'static>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<InboxMessage>>> + Send;

    /// The apps the person connected for tool use, by slug.
    fn apps(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<String>>> + Send;
}

/// Routine suggestions as the API serves them.
pub trait RoutineSuggestionApi: Send + Sync + 'static {
    /// The person's suggestions: AI's, then Macro's templates filling each
    /// surface (only `surface`, when given). Reading never generates.
    fn suggestions(
        &self,
        user: &MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> impl Future<Output = Result<RoutineSuggestions>> + Send;

    /// What a routines session suggesting for `surfaces`, of a generation
    /// started by `trigger`, is told: the person's newest mail and apps as
    /// untrusted data, the catalog, and what they dismissed.
    fn brief(
        &self,
        user: &MacroUserIdStr<'static>,
        surfaces: &[Surface],
        trigger: GenerationTrigger,
        timezone: chrono_tz::Tz,
    ) -> impl Future<Output = Result<String>> + Send;

    /// How many suggestions the person's routines session `session` kept.
    fn kept(
        &self,
        user: &MacroUserIdStr<'static>,
        session: Uuid,
    ) -> impl Future<Output = Result<u32>> + Send;

    /// Log what a generation's routines sessions did for the person: one
    /// `routine_suggestions.generated` event and one
    /// `routine_suggestions.surface` per surface, the dashboard's contract.
    fn record(
        &self,
        user: &MacroUserIdStr<'static>,
        report: RoutineGenerationReport,
    ) -> impl Future<Output = ()> + Send;

    /// Every suggestion AI made for the person, for the routines session
    /// the request `correlation` names.
    fn review(
        &self,
        principal: &model_owner::CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> impl Future<Output = Result<SuggestionReview>> + Send;

    /// Retire an open suggestion that no longer fits, from a routines
    /// session.
    fn retire(
        &self,
        principal: &model_owner::CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireSuggestion,
    ) -> impl Future<Output = Result<SuggestOutcome>> + Send;

    /// The person isn't interested in suggestion `id`, AI's or a template:
    /// it is never suggested again.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Keep a suggestion a routines session hands back, from the request
    /// `correlation` names (its code-mode invocation), after checking it.
    /// Only the person's own open routines sessions may suggest.
    fn suggest(
        &self,
        principal: &model_owner::CreationPrincipal,
        correlation: Option<Uuid>,
        request: SuggestRequest,
    ) -> impl Future<Output = Result<SuggestOutcome>> + Send;
}

/// Where the person's latest generation is, as the generations' owner
/// records it. Object-safe, so the harness hands in one adapter.
#[async_trait::async_trait]
pub trait GenerationStatuses: Send + Sync + 'static {
    /// The status of the person's latest generation; none when they never
    /// had one.
    async fn latest(&self, user: &MacroUserIdStr<'_>) -> Result<Option<GenerationStatus>>;
}

/// What keeping a suggestion did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kept {
    /// Stored, with this id.
    Stored(Uuid),
    /// Its routine idea would pass the person's open ideas limit.
    IdeasFull,
    /// Its routine idea would pass the generation's new ideas limit.
    NightFull,
}
