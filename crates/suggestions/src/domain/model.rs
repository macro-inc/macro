//! What a suggestion is, as stored, served to the person and written by
//! generation sessions.

use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::run::{RunState, RunStateName};

#[cfg(test)]
mod test;

/// One proactive suggestion for one person.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// The suggestion's id.
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    /// Names the suggestion across nights: proposing the same key again changes
    /// this suggestion instead of adding one.
    pub dedup_key: String,
    /// What to do, in a few words.
    pub title: String,
    /// Why, in a line or two.
    pub summary: String,
    /// 0 to 100, for ordering.
    pub importance: u8,
    /// The feed's filters it shows under.
    pub categories: Vec<Category>,
    /// Where it is for the person.
    pub state: SuggestionState,
    /// Why it was resolved; only on resolved suggestions.
    pub state_reason: Option<String>,
    /// The items it is about.
    pub about: Vec<Target>,
    /// What acting on it produced.
    pub produced: Vec<Target>,
    /// When it was first proposed.
    pub created_at: DateTime<Utc>,
    /// When it last changed.
    pub updated_at: DateTime<Utc>,
    /// When its state last changed, such as when it was dismissed.
    pub state_changed_at: DateTime<Utc>,
    /// What the card shows: whether it is open, being run, failed or done.
    pub status: SuggestionStatus,
    /// A background prompt suggestion's latest run.
    pub run: Option<SuggestionRun>,
    /// What to open to see how acting on it went, once known: the item its
    /// finished run made (else the run's session), a failed run's session,
    /// or what was made from a done suggestion that didn't run.
    pub result: Option<Target>,
    /// Its kind, with that kind's data.
    #[serde(flatten)]
    pub kind: SuggestionKind,
}

/// What to open to see how acting on a suggestion in `state`, whose latest run
/// is `run` and which produced `produced`, went: only for a done suggestion
/// (what its finished run made, else the session; what was made without a
/// run) or an accepted one whose run failed (the session). An open suggestion
/// shows none, even one restored while its old run settled.
pub fn result_of(
    state: SuggestionState,
    run: Option<&SuggestionRun>,
    produced: &[Target],
) -> Option<Target> {
    let made = || {
        produced
            .iter()
            .find(|target| target.entity_type != EntityType::AgentSession)
            .cloned()
    };
    let session = |run: &SuggestionRun| Target {
        entity_type: EntityType::AgentSession,
        entity_id: run.session_id.to_string(),
        part_id: None,
    };
    match (state, run) {
        (SuggestionState::Done, Some(run)) if run.state == RunStateName::Finished => {
            made().or_else(|| Some(session(run)))
        }
        (SuggestionState::Done, None) => made(),
        (SuggestionState::Accepted, Some(run)) if run.state == RunStateName::Failed => {
            Some(session(run))
        }
        _ => None,
    }
}

/// What a suggestion's card shows, from its state and its latest run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, strum::AsRefStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SuggestionStatus {
    /// Open, nothing under way: shown to act on (an agent may have taken a
    /// background prompt suggestion on for the person to run).
    Open,
    /// Its latest run hasn't settled: it is starting, working, waiting or
    /// being stopped for running over its time.
    Running,
    /// Accepted, and its latest run failed: running it again retries.
    Failed,
    /// Done.
    Done,
    /// Dismissed, resolved or retired; never in the feed.
    Closed,
}

impl SuggestionStatus {
    /// The status of a suggestion in `state` whose latest run is `run`. A run
    /// being cancelled isn't running: its suggestion closed, or was restored
    /// to be run again.
    pub fn of(state: SuggestionState, run: Option<&SuggestionRun>) -> Self {
        match (state, run.map(|run| run.state)) {
            (SuggestionState::Done, _) => Self::Done,
            (
                SuggestionState::Dismissed | SuggestionState::Resolved | SuggestionState::Retired,
                _,
            ) => Self::Closed,
            (_, Some(run)) if !run.is_settled() && run != RunStateName::Cancelling => Self::Running,
            (SuggestionState::Accepted, Some(RunStateName::Failed)) => Self::Failed,
            (SuggestionState::Proposed | SuggestionState::Accepted, _) => Self::Open,
        }
    }
}

/// A run of a background prompt suggestion: a hidden agent session of the
/// person's, with the full toolset, that never stops to ask.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionRun {
    /// The agent session: open it to see the result.
    #[schema(value_type = String, format = Uuid)]
    pub session_id: Uuid,
    /// When it started.
    pub started_at: DateTime<Utc>,
    /// Where it is, as stored: reading it never asks the session.
    pub state: RunStateName,
    /// When it entered `state`.
    pub state_changed_at: DateTime<Utc>,
}

/// Where a run's session is, as the scheduler reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    /// Opened, its prompt not taken yet.
    AwaitingPrompt,
    /// Working.
    Running,
    /// Its runtime went away mid-run (a restart, say) without finishing.
    Disconnected,
    /// Waiting for the person to approve a tool call.
    NeedsApproval,
    /// Waiting for the person to answer a question.
    NeedsInput,
    /// Done.
    Finished,
    /// Stopped without finishing.
    Failed,
}

/// Why a run's session couldn't be read.
#[derive(Debug)]
pub enum SessionReadError {
    /// It doesn't exist: it never opened, or was deleted.
    Missing,
    /// It couldn't be read just now; it may well be running.
    Unreadable(rootcause::Report),
}

/// Why a run's session didn't start.
#[derive(Debug)]
pub enum RunStartError {
    /// Nothing is running: the run may be settled failed and tried again.
    NotStarted(rootcause::Report),
    /// The prompt may have been taken: the run stays for its session to
    /// settle it, and is never started again meanwhile.
    Uncertain(rootcause::Report),
}

/// A run as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRun {
    /// The agent session.
    pub session: Uuid,
    /// The suggestion it runs.
    pub suggestion: Uuid,
    /// Whose.
    pub user: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// The agent it runs as.
    pub agent: Uuid,
    /// Its first prompt's action.
    pub action: Uuid,
    /// When it started.
    pub started_at: DateTime<Utc>,
    /// Where it is.
    pub state: RunState,
    /// When it entered `state`: with `state`, what a write expects to find.
    pub state_changed_at: DateTime<Utc>,
    /// What it may send or post: the suggestion's `sends` when it started.
    pub sends: Option<String>,
}

/// What kind of suggestion it is, with that kind's data. A kind never changes.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SuggestionKind {
    /// A prompt for an agent: opened in the composer, or run in the
    /// background.
    #[serde(rename_all = "camelCase")]
    Prompt {
        /// What the agent is asked to do.
        prompt: String,
        /// How it runs.
        run_mode: RunMode,
        /// For a background run that posts or sends something: what, and
        /// where, in plain words. The card shows it before Run, and running
        /// it approves exactly that. None when the run posts and sends
        /// nothing.
        sends: Option<String>,
    },
    /// A note about specific items, with what to do about them.
    #[serde(rename_all = "camelCase")]
    Entity {
        /// What to do about the items.
        action: EntityAction,
        /// A reply suggestion's draft, once a session wrote one: the email thread
        /// it is in, with the draft as the part.
        draft: Option<SuggestionDraft>,
        /// A reply suggestion's: when the message the person hasn't answered
        /// came, as read from its item when the suggestion was last written.
        waiting_since: Option<DateTime<Utc>>,
        /// A reply suggestion's: that message's sender, by name.
        from: Option<String>,
    },
    /// A routine suggestion, shown among suggestions.
    #[serde(rename_all = "camelCase")]
    Routine {
        /// The suggestion it shows.
        #[schema(value_type = String, format = Uuid)]
        routine_suggestion_id: Uuid,
    },
}

/// A reply suggestion's draft.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionDraft {
    /// The email thread it is in, with the draft as the part.
    #[serde(flatten)]
    pub target: Target,
    /// The start of its plain text, as it was when attached.
    pub preview: Option<String>,
}

/// Who a reply suggestion's item waits on the person for, and since when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Waiting {
    /// When the message the person hasn't answered came.
    pub since: DateTime<Utc>,
    /// Its sender, by name, when they have one.
    pub from: Option<String>,
}

/// The most characters of a sender's name a card shows.
pub const MAX_SENDER_CHARS: usize = 80;

/// `name` as a card may show it for who a reply waits on: one plain line,
/// never an email address or other personal detail.
pub fn sender_name(name: &str) -> Option<String> {
    shown_text::line(name, MAX_SENDER_CHARS)
        .filter(|name| shown_text::personal_detail(name).is_none())
}

/// The most characters of a draft's plain text a card previews.
pub const DRAFT_PREVIEW_CHARS: usize = 300;

/// The start of `text` a card previews: its words with whitespace collapsed,
/// at most [`DRAFT_PREVIEW_CHARS`] characters; `None` when it has none.
pub fn preview_of(text: &str) -> Option<String> {
    let mut preview = String::new();
    for (count, word) in text.split_whitespace().enumerate() {
        if count > 0 {
            preview.push(' ');
        }
        preview.push_str(word);
        if preview.chars().count() >= DRAFT_PREVIEW_CHARS {
            break;
        }
    }
    let preview: String = preview.chars().take(DRAFT_PREVIEW_CHARS).collect();
    (!preview.is_empty()).then_some(preview)
}

impl SuggestionKind {
    /// The kind, without its data.
    pub fn name(&self) -> KindName {
        match self {
            Self::Prompt { .. } => KindName::Prompt,
            Self::Entity { .. } => KindName::Entity,
            Self::Routine { .. } => KindName::Routine,
        }
    }
}

/// A suggestion's kind, without its data.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum KindName {
    /// A prompt for an agent.
    Prompt,
    /// A note about items.
    Entity,
    /// A routine suggestion.
    Routine,
}

/// Where a suggestion is for the person.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SuggestionState {
    /// Shown, not acted on yet.
    Proposed,
    /// The person acted on it, and it is under way.
    Accepted,
    /// Finished: what it suggested was done.
    Done,
    /// The person isn't interested.
    Dismissed,
    /// Something happened that ended it, such as the email being answered.
    Resolved,
    /// A generation session found it no longer matters.
    Retired,
}

impl SuggestionState {
    /// Proposed or accepted: shown, and open to sessions' changes.
    pub fn is_open(self) -> bool {
        matches!(self, Self::Proposed | Self::Accepted)
    }
}

/// A filter on the feed. Not kinds: a suggestion may have several.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Category {
    /// Matters now.
    Important,
    /// Worth coming back to.
    Revisit,
    /// Saves money.
    SaveMoney,
    /// Makes money.
    MakeMoney,
}

/// How a prompt suggestion runs.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RunMode {
    /// Opened in the composer, prefilled, for the person to send.
    Composer,
    /// Run in a hidden session; the person sees the result.
    Background,
}

/// What an entity suggestion suggests doing about its items.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EntityAction {
    /// Answer it.
    Reply,
    /// Look at it.
    Review,
    /// Chase it up.
    FollowUp,
}

/// How an item relates to a suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum TargetRole {
    /// What the suggestion is about.
    About,
    /// What acting on it made.
    Produced,
    /// The draft made for it.
    Draft,
}

/// An item, or a part of one such as a message in a thread.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    /// The item's type.
    pub entity_type: EntityType,
    /// The item's id.
    pub entity_id: String,
    /// A part of it, such as one message in a channel.
    #[serde(default)]
    pub part_id: Option<String>,
}

/// A person's feed: their open suggestions, best first, and the ones they
/// finished in the last day, newest first. Both lists are in the order to
/// show them.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionFeed {
    /// The open suggestions, at most `limit` of them.
    pub suggestions: Vec<Suggestion>,
    /// Suggestions done in the last 24 hours, with what they produced; left
    /// out when the feed was read with a `limit`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<Vec<Suggestion>>,
    /// How many suggestions the whole feed holds of each status, whatever the
    /// `limit`.
    pub counts: FeedCounts,
}

/// How many of a person's shown suggestions have each status.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeedCounts {
    /// Open, nothing under way.
    pub open: u32,
    /// Their run is under way.
    pub running: u32,
    /// Their last run failed.
    pub failed: u32,
    /// Done in the last 24 hours.
    pub done: u32,
}

impl FeedCounts {
    /// The counts of `suggestions`.
    pub fn of<'a>(suggestions: impl IntoIterator<Item = &'a Suggestion>) -> Self {
        let mut counts = Self::default();
        for suggestion in suggestions {
            let count = match suggestion.status {
                SuggestionStatus::Open => &mut counts.open,
                SuggestionStatus::Running => &mut counts.running,
                SuggestionStatus::Failed => &mut counts.failed,
                SuggestionStatus::Done => &mut counts.done,
                SuggestionStatus::Closed => continue,
            };
            *count = count.saturating_add(1);
        }
        counts
    }
}

/// What a generation session reads before managing the person's suggestions:
/// every suggestion they have, open or not, and how many more it may add.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionsReview {
    /// Open suggestions first, best first, then closed ones newest first. A
    /// dismissed suggestion's `stateChangedAt` is when the person dismissed it.
    pub suggestions: Vec<Suggestion>,
    /// Open suggestions the person has, and the most they may have.
    pub open: u32,
    /// The most open suggestions a person may have.
    pub open_limit: u32,
    /// Suggestions this generation may still add or bring back.
    pub new_left: u32,
}

/// A new suggestion, or a new version of one with the same `dedupKey`, as a
/// generation session hands it back through `macro.suggestions.suggest`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewSuggestion {
    /// `prompt` or `entity`; routine suggestions come from `macro.routines.suggest`.
    pub kind: KindName,
    /// Names the suggestion across nights; the same key updates the same suggestion.
    pub dedup_key: String,
    /// What to do, in a few words.
    pub title: String,
    /// Why, in a line or two.
    pub summary: String,
    /// 0 to 100.
    pub importance: u8,
    /// The feed's filters it shows under.
    #[serde(default)]
    pub categories: Vec<Category>,
    /// The items it is about.
    #[serde(default)]
    pub about: Vec<Target>,
    /// A prompt suggestion's prompt.
    #[serde(default)]
    pub prompt: Option<String>,
    /// A prompt suggestion's run mode.
    #[serde(default)]
    pub run_mode: Option<RunMode>,
    /// A background prompt suggestion that posts or sends: what, and where.
    #[serde(default)]
    pub sends: Option<String>,
    /// An entity suggestion's action.
    #[serde(default)]
    pub action: Option<EntityAction>,
    /// Why, for the change log; required to bring back a suggestion the person
    /// dismissed.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Changes to an open suggestion; fields left out stay.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewriteSuggestion {
    /// A new title.
    #[serde(default)]
    pub title: Option<String>,
    /// A new summary.
    #[serde(default)]
    pub summary: Option<String>,
    /// A new importance.
    #[serde(default)]
    pub importance: Option<u8>,
    /// New categories.
    #[serde(default)]
    pub categories: Option<Vec<Category>>,
    /// New items it is about.
    #[serde(default)]
    pub about: Option<Vec<Target>>,
    /// Only on prompt suggestions.
    #[serde(default)]
    pub prompt: Option<String>,
    /// Only on background prompt suggestions: what the run posts or sends, and
    /// where.
    #[serde(default)]
    pub sends: Option<String>,
    /// Why, for the change log.
    pub reason: String,
}

/// Retiring an open suggestion that no longer matters.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetireSuggestionRequest {
    /// Why, for the change log.
    pub reason: String,
}

/// A reply draft a session wrote for an open reply suggestion, as the user,
/// through `macro.email.createDraft`. It replaces the suggestion's draft, if any;
/// nothing is ever sent.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachDraft {
    /// The email draft: an unsent draft in one of the user's own inboxes, in
    /// the thread the suggestion is about.
    #[schema(value_type = String, format = Uuid)]
    pub email_draft_id: Uuid,
    /// Why, for the change log.
    pub reason: String,
}

/// What became of a session's write.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionWriteOutcome {
    /// Whether it was applied.
    pub ok: bool,
    /// Why it wasn't, to fix and try again.
    pub problems: Vec<String>,
    /// The suggestion as it now is.
    pub suggestion: Option<Suggestion>,
}

impl SuggestionWriteOutcome {
    /// Not applied, for `problems`.
    pub fn rejected(problems: Vec<String>) -> Self {
        Self {
            ok: false,
            problems,
            suggestion: None,
        }
    }

    /// Applied; `suggestion` as it now is.
    pub fn applied(suggestion: Suggestion) -> Self {
        Self {
            ok: true,
            problems: Vec::new(),
            suggestion: Some(suggestion),
        }
    }
}

/// A suggestion's words and items, checked and ready to store.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionContent {
    /// See [`Suggestion::dedup_key`].
    pub dedup_key: String,
    /// See [`Suggestion::title`].
    pub title: String,
    /// See [`Suggestion::summary`].
    pub summary: String,
    /// See [`Suggestion::importance`].
    pub importance: u8,
    /// See [`Suggestion::categories`].
    pub categories: Vec<Category>,
    /// See [`Suggestion::about`].
    pub about: Vec<Target>,
    /// A prompt suggestion's prompt.
    pub prompt: Option<String>,
    /// A background prompt suggestion's [`SuggestionKind::Prompt::sends`].
    pub sends: Option<String>,
    /// A reply suggestion's [`Waiting`], read from its items rather than
    /// written by the session, so never in the change log.
    #[serde(skip)]
    pub waiting: Option<Waiting>,
}

impl SuggestionContent {
    /// `suggestion`'s content.
    pub fn of(suggestion: &Suggestion) -> Self {
        Self {
            dedup_key: suggestion.dedup_key.clone(),
            title: suggestion.title.clone(),
            summary: suggestion.summary.clone(),
            importance: suggestion.importance,
            categories: suggestion.categories.clone(),
            about: suggestion.about.clone(),
            prompt: match &suggestion.kind {
                SuggestionKind::Prompt { prompt, .. } => Some(prompt.clone()),
                SuggestionKind::Entity { .. } | SuggestionKind::Routine { .. } => None,
            },
            sends: match &suggestion.kind {
                SuggestionKind::Prompt { sends, .. } => sends.clone(),
                SuggestionKind::Entity { .. } | SuggestionKind::Routine { .. } => None,
            },
            waiting: match &suggestion.kind {
                SuggestionKind::Entity {
                    waiting_since: Some(since),
                    from,
                    ..
                } => Some(Waiting {
                    since: *since,
                    from: from.clone(),
                }),
                SuggestionKind::Entity { .. }
                | SuggestionKind::Prompt { .. }
                | SuggestionKind::Routine { .. } => None,
            },
        }
    }
}

/// What kind a new suggestion is, with its fixed data.
#[derive(Debug, Clone, PartialEq)]
pub enum NewKind {
    /// A prompt suggestion.
    Prompt {
        /// How it runs.
        run_mode: RunMode,
    },
    /// An entity suggestion.
    Entity {
        /// What to do about its items.
        action: EntityAction,
    },
}

/// What starts a generation: a person finishing onboarding, or their night.
/// Shared by everything a generation's sessions write.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::AsRefStr, strum::IntoStaticStr,
)]
#[strum(serialize_all = "snake_case")]
pub enum GenerationTrigger {
    /// The person just signed up; their workspace is nearly empty.
    Onboarding,
    /// The nightly run in the person's night: full research, then manage.
    Nightly,
}

/// What a generation session may call: suggestions or routine suggestions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SessionKind {
    /// Writes suggestions.
    Suggestions,
    /// Writes routine suggestions.
    Routines,
}

/// An open hidden session of a generation.
#[derive(Debug, Clone, PartialEq)]
pub struct GenerationSession {
    /// The agent session.
    pub session: Uuid,
    /// The generation it is part of.
    pub generation: Uuid,
    /// Whose it is.
    pub user: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// What it may write.
    pub kind: SessionKind,
    /// The surfaces a routines session suggests for, by wire name; empty
    /// for suggestions.
    pub surfaces: Vec<String>,
    /// The trace its generation runs in. A session's tool calls reach the
    /// API without its trace context, so they record this to be joined.
    pub trace_id: Option<String>,
}

/// The person acting on a suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Accept {
    /// When the suggestion was last changed as the caller's copy shows it: a
    /// background suggestion runs only if it is still what they saw.
    pub shown_updated_at: DateTime<Utc>,
    /// Whether the person themself acts, in the app: only they start a
    /// background suggestion's run. Anyone else (an agent of theirs) at most marks
    /// it accepted, for them to run.
    pub by_person: bool,
}

/// Who reads the person's feed or acts on one of their suggestions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SuggestionCaller {
    /// The person, in the app.
    User,
    /// An agent acting for the person, such as their chat agent's program.
    Agent {
        /// The code-mode invocation the agent's credential names, when it
        /// has one; a generation session's is refused.
        correlation: Option<Uuid>,
    },
}

/// What a change-log entry records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ChangeAction {
    /// Added.
    Created,
    /// Changed while open.
    Rewritten,
    /// Retired.
    Retired,
    /// Brought back from a closed state.
    Restored,
}

/// One change a generation session made, for the change log.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    /// The session that made it.
    pub session: Uuid,
    /// Its generation.
    pub generation: Uuid,
    /// What it did.
    pub action: ChangeAction,
    /// The value before.
    pub old: Option<serde_json::Value>,
    /// The value after.
    pub new: Option<serde_json::Value>,
    /// The session's reason.
    pub reason: Option<String>,
    /// When.
    pub at: DateTime<Utc>,
}

/// Why code resolved a suggestion, as stored in `state_reason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ResolveReason {
    /// The person answered what the suggestion asked them to answer.
    Replied,
    /// An item it is about was deleted.
    Deleted,
    /// The person can no longer open an item it is about.
    AccessLost,
}

/// An open suggestion about an item, once per target naming that item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenTarget {
    /// The suggestion.
    pub suggestion: Uuid,
    /// Whose it is.
    pub user: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// When it was first proposed.
    pub created_at: DateTime<Utc>,
    /// Whether it is an entity suggestion asking for a reply.
    pub reply: bool,
    /// The part of the item the target names, if only a part.
    pub part_id: Option<String>,
}

/// Why a suggestions call failed.
#[derive(Debug, thiserror::Error)]
pub enum SuggestionError {
    /// No such suggestion for the person, or suggestions are off for them.
    #[error("suggestion not found")]
    NotFound,
    /// Only an open suggestions session of the person's may call this.
    #[error("only a suggestions generation session may do this")]
    NotGenerating,
    /// A generation session may not read the feed or act on a suggestion for
    /// the person.
    #[error("a generation session may not read the feed or act on suggestions")]
    Generating,
    /// The suggestion changed since the caller read it: here it is as it is now.
    #[error("the suggestion changed since it was read; read it again")]
    Changed(Box<Suggestion>),
    /// Only a suggestion the person dismissed in the last few minutes comes
    /// back, and not a routine suggestion.
    #[error("only a suggestion dismissed in the last five minutes can be restored")]
    NotRestorable,
    /// Anything else.
    #[error("internal suggestions error: {0:?}")]
    Internal(rootcause::Report),
}

impl SuggestionError {
    /// An adapter's error, as an internal one.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}
