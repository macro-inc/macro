//! What routine suggestions need from outside: storage, what the person's
//! accounts hold, and the hidden agent sessions that suggest.

use std::future::Future;

use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde::Serialize;

use super::model::{
    CheckedSuggestion, RoutineSuggestions, StoredGeneration, StoredSuggestion, SuggestOutcome,
    SuggestRequest,
};

/// Each person's generation, the sessions suggesting for it, and what they
/// handed back.
pub trait SuggestionRepo: Send + Sync + 'static {
    /// The person's generation, if one ever started.
    fn generation(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<StoredGeneration>>> + Send;

    /// Start the person's one generation at `now`; false when one started
    /// before and finished, or is still running. A generation still marked
    /// running that started before `stale_before` was interrupted (its
    /// process stopped) and is started again.
    fn begin(
        &self,
        user: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Record how the person's generation ended.
    fn finish(
        &self,
        user: &MacroUserIdStr<'_>,
        ready: bool,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Let hidden session `session`, run as `agent` for the person, suggest
    /// for `surfaces`.
    fn open_session(
        &self,
        session: Uuid,
        user: &MacroUserIdStr<'_>,
        agent: bot_id::BotId,
        surfaces: &[Surface],
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The suggestion session `session`, if it is one and still open.
    fn session(
        &self,
        session: Uuid,
    ) -> impl Future<Output = Result<Option<SuggestionSession>>> + Send;

    /// Close `session`: it may suggest no more.
    fn close_session(&self, session: Uuid) -> impl Future<Output = Result<()>> + Send;

    /// Sessions opened before `before` and never closed, oldest first, at
    /// most `limit`: left behind by a process that stopped.
    fn stale_sessions(
        &self,
        before: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<SuggestionSession>>> + Send;

    /// Keep `suggestion`, handed back by `session` for the person; its id.
    fn add(
        &self,
        user: &MacroUserIdStr<'_>,
        session: Uuid,
        suggestion: &CheckedSuggestion,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Uuid>> + Send;

    /// Every suggestion AI made for the person, dismissed ones too.
    fn suggestions(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<StoredSuggestion>>> + Send;

    /// Catalog routines the person dismissed as Macro's templates, by key.
    fn dismissed_templates(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<String>>> + Send;

    /// Dismiss the person's suggestion `id` for good; whether it was theirs.
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

/// A hidden session suggesting routines for its owner.
#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionSession {
    pub session: Uuid,
    pub owner: MacroUserIdStr<'static>,
    pub agent: bot_id::BotId,
    /// The surfaces it suggests for.
    pub surfaces: Vec<Surface>,
    /// How many suggestions it kept so far.
    pub kept: u32,
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

    /// Start the person's one generation in the background, if it never
    /// started: their inbox is connected. Later calls change nothing.
    fn generate(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> impl Future<Output = Result<RoutineSuggestions>> + Send;

    /// The person isn't interested in suggestion `id`, AI's or a template:
    /// it is never suggested again.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Keep a suggestion a suggestion session hands back, from the request
    /// `correlation` names (its code-mode invocation), after checking it.
    /// Only the person's own open suggestion sessions may suggest.
    fn suggest(
        &self,
        principal: &model_owner::CreationPrincipal,
        correlation: Option<Uuid>,
        request: SuggestRequest,
    ) -> impl Future<Output = Result<SuggestOutcome>> + Send;
}
