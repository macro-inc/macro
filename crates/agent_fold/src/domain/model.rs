//! The renderable message vocabulary.
//!
//! These types are the fold's output: what an agent session looks like once
//! its protocol log has been collapsed into something a channel can display.
//! Nothing here is persisted - a [`FoldedMessage`] is derived from
//! `agent_session_log` on every read, so the vocabulary is free to change
//! without a migration.
//!
//! The shapes are deliberately lossy. ACP carries plenty that no reader wants
//! to see (token usage, mode changes, capability handshakes); those frames are
//! dropped rather than modelled. What survives is the material a person would
//! recognize as the story of the session: what they asked, what the agent
//! said, what it ran, and what it wanted permission to do.

use agent_runtime_protocol::domain::action::AgentActionId;
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;
use serde::Serialize;
use specta::Type;
use std::{borrow::Cow, path::PathBuf, str::FromStr};

/// One prompt-to-stop cycle within a session.
///
/// Assigned by the fold in log order starting at zero, so the same log always
/// yields the same ids. This is not the ACP request id - that correlation is
/// internal to the fold.
///
/// A turn is not the unit a channel renders - see [`MessageId`], which is
/// what a comms placeholder stores.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct TurnId(pub u32);

/// A tool call within a turn, identified by its ACP `toolCallId`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct ToolUseId(pub String);

/// The natural key of a [`FoldedMessage`] within its session.
///
/// Nothing here is stored, so there is no surrogate row id to hand out.
/// Instead the key falls out of the fold's shape: a turn yields at most one
/// message per side of the conversation, so `(turn, author side)` identifies
/// a message - and because [`TurnId`]s are assigned in log order, the same
/// log always derives the same keys. Queries that pretend the messages are
/// stored address them by this.
///
/// The one exception to "nothing here is persisted": a comms placeholder
/// message stores the message it renders, as these two fields alongside a
/// session id, relying on exactly this stability. They stay two fields
/// everywhere they travel - column, wire, and JSON - so nothing has to format
/// or reparse a composite to get at either half. One placeholder per message,
/// not per turn: a turn's prompt and its reply are separate rows so each can
/// carry its own sender.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct MessageId {
    /// The turn the message belongs to.
    pub turn: TurnId,
    /// Which side of the conversation produced it.
    pub author: AuthorKind,
}

impl MessageId {
    /// The first folded message authored by `author` in a session.
    #[must_use]
    pub const fn first(author: AuthorKind) -> Self {
        Self {
            turn: TurnId(0),
            author,
        }
    }

    /// Address the other side of this turn without changing its turn id.
    #[must_use]
    pub const fn with_author(self, author: AuthorKind) -> Self {
        Self {
            turn: self.turn,
            author,
        }
    }
}

/// Which side of the conversation produced a message.
///
/// The identity-free discriminant of [`Author`], usable in a key where
/// [`Author`] itself carries a payload.
///
/// The wire names a [`MessageId`] is written with and parsed back from are
/// the strum-derived `snake_case` variant names - one source of truth for
/// both directions.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    strum::Display,
    strum::EnumString,
    strum::IntoStaticStr,
    serde::Serialize,
    serde::Deserialize,
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AuthorKind {
    /// A person.
    User,
    /// The agent.
    Agent,
}

impl AuthorKind {
    /// The wire name, as it appears in a [`MessageId`]'s string form.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

/// One renderable message folded out of a session's protocol log.
///
/// A turn produces at most two of these: the user's prompt and the agent's
/// reply. Both carry their content as an ordered part list, so a reader can
/// collapse runs of tool activity or interleave text and tools however it
/// likes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldedMessage {
    /// the id of this message
    #[serde(rename = "turn")]
    pub id: TurnId,
    /// Who produced it.
    pub author: Author,
    /// The ACP request id of the frame that derived this message - the same
    /// string the control endpoint returned, for correlation. `None` on agent
    /// messages and on frames the control plane did not mint (other clients'
    /// requests, notifications).
    pub request_id: Option<AgentActionId>,
    /// Ordered content. Never empty - the fold drops messages with no parts.
    pub parts: NonEmpty<Vec<MessagePart>>,
    /// How the turn ended, on the agent message that closed it.
    ///
    /// `None` while a turn is still in flight, or when the session died
    /// without a response to the prompt.
    pub stop: Option<StopReason>,
}

impl FoldedMessage {
    /// This message's natural key within its session.
    #[must_use]
    pub fn id(&self) -> MessageId {
        MessageId {
            turn: self.id,
            author: self.author.kind(),
        }
    }
}

/// Who produced a [`FoldedMessage`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Author {
    /// A person, via `session/prompt`.
    ///
    /// The id comes from the log row rather than the ACP payload, and is
    /// absent when the prompt was not attributed to a user.
    User {
        /// The attributed user's id.
        #[serde(rename = "userId")]
        #[specta(type = Option<String>)]
        user_id: Option<MacroUserIdStr<'static>>,
    },
    /// The agent.
    Agent,
}

impl Author {
    /// Which side of the conversation this author is, identity dropped.
    #[must_use]
    pub fn kind(&self) -> AuthorKind {
        match self {
            Self::User { .. } => AuthorKind::User,
            Self::Agent => AuthorKind::Agent,
        }
    }
}

/// A unit of renderable content.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MessagePart {
    /// Prose from the user or the agent.
    Text {
        /// The prose.
        text: String,
    },
    /// The agent's reasoning, which a reader may want to hide by default.
    Thought {
        /// The reasoning.
        text: String,
    },
    /// A tool the agent invoked.
    ToolUse {
        /// The ACP `toolCallId`.
        id: ToolUseId,
        /// What to show as the tool's name.
        label: String,
        /// Where the call got to.
        status: ToolStatus,
        /// What the tool did, as far as the log reveals.
        detail: ToolDetail,
        /// The call's input, verbatim from ACP's `rawInput`, when reported.
        ///
        /// Carried on every call - not just [`ToolDetail::Other`] - so a
        /// reader that knows a tool by name (the Macro toolset renders each
        /// tool with its own component) can parse the real arguments instead
        /// of settling for the coarse detail.
        #[serde(rename = "rawInput")]
        #[specta(type = specta_typescript::Unknown)]
        raw_input: Option<Box<serde_json::Value>>,
        /// The call's result, verbatim from ACP's `rawOutput`, when reported.
        ///
        /// The structured counterpart to the text a detail may carry: Macro's
        /// agent reports each tool response as JSON here, and named-tool
        /// rendering needs that JSON whole.
        #[serde(rename = "rawOutput")]
        #[specta(type = specta_typescript::Unknown)]
        raw_output: Option<Box<serde_json::Value>>,
    },
    /// The agent asking to proceed.
    Permission {
        /// The tool call permission was requested for.
        #[serde(rename = "toolCall")]
        tool_call: ToolUseId,
        /// The choices offered, in the order ACP listed them.
        options: Vec<PermissionOption>,
        /// How the request has resolved so far.
        outcome: PermissionOutcome,
    },
    /// A user-issued control operation on the session.
    Control {
        /// The requested operation.
        control: Control,
        /// How the runtime disposed of it so far.
        outcome: ControlOutcome,
    },
    /// The agent's working todo list for the turn.
    Plan {
        /// The tasks, in the order the agent listed them.
        entries: Vec<PlanEntry>,
    },
}

/// One task on an agent plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    /// What this task aims to accomplish.
    pub content: String,
    /// The task's relative importance.
    pub priority: PlanEntryPriority,
    /// Where the task got to.
    pub status: PlanEntryStatus,
}

/// A [`PlanEntry`]'s relative importance, mirroring ACP's
/// `PlanEntryPriority`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanEntryPriority {
    /// Critical to the overall goal.
    High,
    /// Important but not critical.
    Medium,
    /// Nice to have but not essential.
    Low,
}

/// Where a [`PlanEntry`] got to, mirroring ACP's `PlanEntryStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanEntryStatus {
    /// Not started yet.
    Pending,
    /// Currently being worked on.
    InProgress,
    /// Successfully completed.
    Completed,
}

/// A session control operation shown in the conversation timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Control {
    /// The runtime was asked to switch models.
    SetModel {
        /// The model slug requested by the caller.
        model: String,
    },
    /// The runtime was asked to compact its context.
    Compact,
    /// The runtime was asked to stop its current work.
    Stop,
}

/// How the runtime disposed of a [`Control`], like [`PermissionOutcome`] for
/// permission requests. Pending is a legitimate final state: a control the
/// session died before answering stays pending.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ControlOutcome {
    /// No response yet.
    Pending,
    /// Acknowledged - immediately so for a stop, which nothing can answer.
    Accepted,
    /// Answered with a JSON-RPC error.
    Rejected {
        /// The error's message, verbatim.
        message: String,
    },
}

/// How far a tool call progressed.
///
/// [`ToolStatus::Pending`] and [`ToolStatus::Running`] are legitimate final
/// states, not errors: a live session's newest calls have not finished, and a
/// session that dies mid-call leaves one behind permanently.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    strum::Display,
    strum::IntoStaticStr,
    Serialize,
    Type,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    /// Not started - either still streaming input or awaiting permission.
    #[default]
    Pending,
    /// Currently running.
    Running,
    /// Finished successfully.
    Completed,
    /// Finished unsuccessfully.
    Failed,
}

/// What a tool call actually did.
///
/// Discriminated by what a reader needs in order to render it, not by ACP's
/// [`ToolKind`](agent_client_protocol::ToolKind). A terminal wants command and
/// output; an edit wants a diff; a handful of others want the paths they
/// touched or whatever text they reported; everything else wants its raw
/// input shown as JSON. Every named [`ToolKind`](agent_client_protocol::ToolKind)
/// has a variant here, so the fold never falls back to [`Self::Other`] for a
/// kind ACP defines - only for `switch_mode` (nothing a reader would want
/// rendered) and a kind this fold does not yet know about.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolDetail {
    /// A shell command. ACP's `execute`.
    Terminal {
        /// The command line, when the harness reported one.
        command: Option<String>,
        /// Captured output, ANSI escapes intact. See [`AnsiText`].
        output: Option<AnsiText>,
        /// Process exit code, when the harness reported one.
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    /// One or more file modifications. ACP's `edit`.
    Edit {
        /// The diffs ACP reported for this call.
        diffs: Vec<FileDiff>,
    },
    /// A file read. ACP's `read`.
    Read {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
    },
    /// One or more files removed. ACP's `delete`.
    Delete {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
    },
    /// One or more files moved or renamed. ACP's `move`.
    ///
    /// Only the paths a reader can be sure of. ACP has no standard field for
    /// "from" versus "to" - a call's `locations` is just the set of paths it
    /// touched - so this does not guess at a direction.
    Move {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
    },
    /// A search. ACP's `search`.
    Search {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
        /// Text the call reported - e.g. matched lines - when any.
        output: Option<String>,
    },
    /// Retrieving external data. ACP's `fetch`.
    Fetch {
        /// Text the call reported, when any.
        output: Option<String>,
    },
    /// Explicit reasoning surfaced as its own tool call, as distinct from
    /// [`MessagePart::Thought`], which is reasoning streamed inline. ACP's
    /// `think`.
    Think {
        /// Text the call reported, when any.
        output: Option<String>,
    },
    /// Anything else: ACP's `switch_mode`, and any kind - including `other`
    /// itself, [`ToolKind`](agent_client_protocol::ToolKind)'s default for a
    /// call that names no kind at all - this fold has no special rendering
    /// for.
    Other {
        /// ACP's tool kind, as its wire string.
        #[serde(rename = "acpKind")]
        kind: String,
        /// Text the call reported, when any.
        output: Option<String>,
        /// The tool's input, when reported.
        #[specta(type = specta_typescript::Unknown)]
        input: Option<serde_json::Value>,
    },
}

/// A file modification a tool reported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// The file that changed.
    pub path: PathBuf,
    /// Prior contents, absent when the file is new.
    pub old_text: Option<String>,
    /// New contents.
    pub new_text: String,
}

/// Terminal output with ANSI escape sequences left in place.
///
/// Stripping here would be lossy and irreversible, and the escapes carry real
/// information - the recordings are full of colorized `ls` and `grep` output.
/// Rendering decides whether to interpret, strip, or ignore them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct AnsiText(pub String);

impl AnsiText {
    /// The raw text, escapes included.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One choice offered for a permission request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    /// The id to report back when this option is chosen.
    pub id: String,
    /// Label to show.
    pub name: String,
    /// What kind of choice this is.
    pub kind: PermissionOptionKind,
}

/// What kind of choice a [`PermissionOption`] offers, mirroring ACP's
/// `PermissionOptionKind`.
///
/// ACP's enum is `#[non_exhaustive]`, but unlike [`StopReason`] there is no
/// wire string worth preserving for a variant this fold does not model: the
/// fold only ever sees one of these once the whole permission request has
/// already deserialized successfully, and a wire value ACP added after this
/// was written would have failed that deserialize already - so an unmatched
/// kind here cannot happen in practice, not "happens and is rendered
/// unlabeled."
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOptionKind {
    /// Allow this operation only this time.
    AllowOnce,
    /// Allow this operation and remember the choice.
    AllowAlways,
    /// Reject this operation only this time.
    RejectOnce,
    /// Reject this operation and remember the choice.
    RejectAlways,
}

/// How a permission request has resolved so far.
///
/// Not just "chosen or not": nothing chosen has more than one cause, and a
/// reader deciding whether to still show the options needs to tell them
/// apart. [`Self::Pending`] may still resolve; [`Self::Errored`] and
/// [`Self::Unrecognized`] have already resolved, just not into anything this
/// fold can show as a choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PermissionOutcome {
    /// No response has arrived yet - the request is still outstanding.
    Pending,
    /// An option was chosen.
    Selected {
        /// The chosen option's id.
        #[serde(rename = "optionId")]
        option_id: String,
    },
    /// The request was cancelled without a choice.
    Cancelled,
    /// The response was a JSON-RPC error rather than a result: the harness
    /// failed to answer the request rather than resolving it.
    Errored,
    /// A result arrived, but this fold could not make sense of it - a
    /// payload that did not match ACP's response shape, or an outcome ACP
    /// added after this was written.
    Unrecognized,
}

/// Why a turn stopped.
///
/// All but one variant is parsed straight off ACP's `stopReason` wire string
/// by [`FromStr`]: the `snake_case` variant names are the wire names, and
/// anything unmodelled falls through to [`Self::Other`], so parsing never
/// fails. [`Self::Failed`] is the exception - no wire string produces it,
/// because it is what a turn that got no `stopReason` at all stopped for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StopReason {
    /// The agent finished its turn.
    EndTurn,
    /// The model hit its token limit.
    MaxTokens,
    /// The agent hit its turn-request limit.
    MaxTurnRequests,
    /// The agent declined.
    Refusal,
    /// The turn was cancelled.
    Cancelled,
    /// A stop reason this fold does not model, as its wire string.
    Other {
        /// The unrecognized wire value.
        reason: String,
    },
    /// The runtime answered the prompt with a JSON-RPC error, so the turn
    /// produced no reply and never will.
    ///
    /// Constructed by the fold, never parsed: an error response carries no
    /// `stopReason` to read. Modelled as a stop reason rather than as
    /// something alongside one because that is what it is - a turn that
    /// ended - and because every reader already asks `stop` whether a turn
    /// is still running. A turn left with no stop reason reads as forever in
    /// flight, which is how a failed prompt used to wedge a session.
    Failed {
        /// The runtime's error message, verbatim.
        message: String,
    },
}

impl FromStr for StopReason {
    type Err = std::convert::Infallible;

    fn from_str(reason: &str) -> Result<Self, Self::Err> {
        Ok(match reason {
            "end_turn" => Self::EndTurn,
            "max_tokens" => Self::MaxTokens,
            "max_turn_requests" => Self::MaxTurnRequests,
            "refusal" => Self::Refusal,
            "cancelled" => Self::Cancelled,
            reason => Self::Other {
                reason: reason.to_owned(),
            },
        })
    }
}

/// Session-level state derived from the log, latest-wins and carried whole.
/// Fields start absent and fill in as the log reveals them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    /// Current model per the runtime's own `configOptions` responses, so a
    /// rejected model change never moves it.
    pub model: Option<String>,
    /// The models the runtime offers, in the order it listed them.
    pub supported_models: Vec<ModelOption>,
    /// Session title, when the harness reports one.
    pub title: Option<String>,
    /// The slash commands the harness most recently advertised, in the order
    /// it listed them. Empty until the first `available_commands_update`,
    /// which arrives right after session setup, before any turn.
    pub available_commands: Vec<AvailableCommand>,
    /// The last system event's wire name (`"acp_ready"`, `"disconnected"`),
    /// `None` until the runtime reports one.
    pub status: Option<String>,
}

/// One slash command the harness advertises.
///
/// Mirrors ACP's `AvailableCommand`, flattened: the only input shape ACP
/// defines today is "unstructured text after the name," so the hint is
/// carried directly rather than through a nested enum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommand {
    /// Bare name as advertised (`"qc"`, `"honeycomb:query-patterns"`) - no
    /// leading slash, which is client syntax rather than part of the name.
    pub name: String,
    /// Human-readable description, verbatim from the harness.
    pub description: String,
    /// Placeholder text for the command's input, when it takes any.
    pub input_hint: Option<String>,
}

/// One model the runtime offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    /// The value to send back to select this model.
    pub id: String,
    /// Human-readable label.
    pub name: String,
    /// Descriptive copy - pricing, context size, and the like.
    pub description: Option<String>,
}

/// One change a pushed log frame implied. A push reports every change in
/// order; most frames report none.
///
/// Payloads are borrowed from the machine and carried whole rather than as
/// deltas: a consumer replaces what it holds under the same
/// [`FoldedMessage::id`], or replaces its metadata outright.
#[derive(Debug, Clone, PartialEq)]
pub enum FoldEvent<'a> {
    /// A message the machine had not derived before. Reported exactly once
    /// per message, before any update to it.
    NewMessage(Cow<'a, FoldedMessage>),
    /// A message the machine had already reported, whose content changed.
    MessageUpdate(Cow<'a, FoldedMessage>),
    /// The metadata changed - restating identical metadata reports nothing.
    MetadataUpdated(Cow<'a, SessionMetadata>),
}

/// A fold event that owns whatever it carries.
pub type OwnedFoldEvent = FoldEvent<'static>;

impl FoldEvent<'_> {
    /// The message that changed, or `None` when this event is not about a
    /// message.
    #[must_use]
    pub fn message(&self) -> Option<&FoldedMessage> {
        match self {
            Self::NewMessage(message) | Self::MessageUpdate(message) => Some(message.as_ref()),
            Self::MetadataUpdated(_) => None,
        }
    }

    /// Own the payload so this event can cross a task boundary.
    #[must_use]
    pub fn into_owned(self) -> OwnedFoldEvent {
        match self {
            Self::NewMessage(message) => FoldEvent::NewMessage(Cow::Owned(message.into_owned())),
            Self::MessageUpdate(message) => {
                FoldEvent::MessageUpdate(Cow::Owned(message.into_owned()))
            }
            Self::MetadataUpdated(metadata) => {
                FoldEvent::MetadataUpdated(Cow::Owned(metadata.into_owned()))
            }
        }
    }
}
