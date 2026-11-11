//! What an idea is, as stored, served to the person and written by
//! generation sessions.

use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// One proactive suggestion for one person.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = Suggestion)]
pub struct Idea {
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
    pub state: IdeaState,
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
    /// A background prompt suggestion's latest run.
    pub run: Option<IdeaRun>,
    /// Its kind, with that kind's data.
    #[serde(flatten)]
    pub kind: IdeaKind,
}

/// A run of a background prompt suggestion: a hidden agent session of the
/// person's, with the full toolset, that never stops to ask.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SuggestionRun)]
pub struct IdeaRun {
    /// The agent session: open it to see the result or answer what it
    /// waits for.
    #[schema(value_type = String, format = Uuid)]
    pub session_id: Uuid,
    /// When it started.
    pub started_at: DateTime<Utc>,
    /// How it is going, read from the session.
    pub progress: RunProgress,
}

/// How a run is going, as its session says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema, strum::AsRefStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RunProgress {
    /// Working.
    Running,
    /// Waiting for the person to approve a tool call.
    NeedsApproval,
    /// Waiting for the person to answer a question.
    NeedsInput,
    /// Done; its result is in the session and the suggestion's `produced`.
    Finished,
    /// It stopped without finishing; accepting the suggestion again retries.
    Failed,
    /// The session couldn't be read just now.
    Unknown,
}

impl RunProgress {
    /// Finished or failed: nothing more will happen.
    pub fn is_over(self) -> bool {
        matches!(self, Self::Finished | Self::Failed)
    }
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

impl SessionState {
    /// How the run shows on its suggestion.
    pub fn progress(self) -> RunProgress {
        match self {
            Self::AwaitingPrompt | Self::Running | Self::Disconnected => RunProgress::Running,
            Self::NeedsApproval => RunProgress::NeedsApproval,
            Self::NeedsInput => RunProgress::NeedsInput,
            Self::Finished => RunProgress::Finished,
            Self::Failed => RunProgress::Failed,
        }
    }
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

/// A run as stored, before its progress is read.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRun {
    /// The agent session.
    pub session: Uuid,
    /// The suggestion it runs.
    pub idea: Uuid,
    /// Whose.
    pub user: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// The agent it runs as.
    pub agent: Uuid,
    /// Its first prompt's action.
    pub action: Uuid,
    /// When it started.
    pub started_at: DateTime<Utc>,
    /// Whether it was settled, and how.
    pub settled: Option<RunSettled>,
}

/// How a finished run was settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunSettled {
    /// It finished: the suggestion is done.
    Finished,
    /// It failed: the suggestion may be accepted again.
    Failed,
}

/// What kind of suggestion it is, with that kind's data. A kind never changes.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[schema(as = SuggestionKind)]
pub enum IdeaKind {
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
        draft: Option<Target>,
    },
    /// A routine suggestion, shown among suggestions.
    #[serde(rename_all = "camelCase")]
    Routine {
        /// The suggestion it shows.
        #[schema(value_type = String, format = Uuid)]
        routine_suggestion_id: Uuid,
    },
}

impl IdeaKind {
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
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[schema(as = SuggestionState)]
pub enum IdeaState {
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

impl IdeaState {
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
/// finished in the last day, newest first.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SuggestionFeed)]
pub struct Ideas {
    /// The open suggestions.
    #[serde(rename = "suggestions")]
    pub ideas: Vec<Idea>,
    /// Suggestions done in the last 24 hours, with what they produced.
    pub done: Vec<Idea>,
}

/// What a generation session reads before managing the person's suggestions:
/// every suggestion they have, open or not, and how many more it may add.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SuggestionsReview)]
pub struct IdeaReview {
    /// Open suggestions first, best first, then closed ones newest first. A
    /// dismissed suggestion's `stateChangedAt` is when the person dismissed it.
    #[serde(rename = "suggestions")]
    pub ideas: Vec<Idea>,
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
#[schema(as = NewSuggestion)]
pub struct SuggestIdea {
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
#[schema(as = RewriteSuggestion)]
pub struct RewriteIdea {
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
#[schema(as = RetireSuggestionRequest)]
pub struct RetireIdea {
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
#[schema(as = SuggestionWriteOutcome)]
pub struct IdeaWriteOutcome {
    /// Whether it was applied.
    pub ok: bool,
    /// Why it wasn't, to fix and try again.
    pub problems: Vec<String>,
    /// The suggestion as it now is.
    #[serde(rename = "suggestion")]
    pub idea: Option<Idea>,
}

impl IdeaWriteOutcome {
    /// Not applied, for `problems`.
    pub fn rejected(problems: Vec<String>) -> Self {
        Self {
            ok: false,
            problems,
            idea: None,
        }
    }

    /// Applied; `suggestion` as it now is.
    pub fn applied(idea: Idea) -> Self {
        Self {
            ok: true,
            problems: Vec::new(),
            idea: Some(idea),
        }
    }
}

/// A suggestion's words and items, checked and ready to store.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaContent {
    /// See [`Idea::dedup_key`].
    pub dedup_key: String,
    /// See [`Idea::title`].
    pub title: String,
    /// See [`Idea::summary`].
    pub summary: String,
    /// See [`Idea::importance`].
    pub importance: u8,
    /// See [`Idea::categories`].
    pub categories: Vec<Category>,
    /// See [`Idea::about`].
    pub about: Vec<Target>,
    /// A prompt suggestion's prompt.
    pub prompt: Option<String>,
    /// A background prompt suggestion's [`IdeaKind::Prompt::sends`].
    pub sends: Option<String>,
}

impl IdeaContent {
    /// `suggestion`'s content.
    pub fn of(idea: &Idea) -> Self {
        Self {
            dedup_key: idea.dedup_key.clone(),
            title: idea.title.clone(),
            summary: idea.summary.clone(),
            importance: idea.importance,
            categories: idea.categories.clone(),
            about: idea.about.clone(),
            prompt: match &idea.kind {
                IdeaKind::Prompt { prompt, .. } => Some(prompt.clone()),
                IdeaKind::Entity { .. } | IdeaKind::Routine { .. } => None,
            },
            sends: match &idea.kind {
                IdeaKind::Prompt { sends, .. } => sends.clone(),
                IdeaKind::Entity { .. } | IdeaKind::Routine { .. } => None,
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
    Ideas,
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
pub enum IdeaCaller {
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
    pub idea: Uuid,
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
pub enum IdeaError {
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
    Changed(Box<Idea>),
    /// Anything else.
    #[error("internal suggestions error: {0:?}")]
    Internal(rootcause::Report),
}

impl IdeaError {
    /// An adapter's error, as an internal one.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}
