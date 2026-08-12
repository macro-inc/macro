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

use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;
use std::{borrow::Cow, path::PathBuf};

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
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
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
#[derive(Debug, Clone, PartialEq)]
pub struct FoldedMessage {
    /// the id of this message
    pub id: TurnId,
    /// Who produced it.
    pub author: Author,
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Author {
    /// A person, via `session/prompt`.
    ///
    /// The id comes from the log row rather than the ACP payload, and is
    /// absent when the prompt was not attributed to a user.
    User(Option<MacroUserIdStr<'static>>),
    /// The agent.
    Agent,
}

impl Author {
    /// Which side of the conversation this author is, identity dropped.
    #[must_use]
    pub fn kind(&self) -> AuthorKind {
        match self {
            Self::User(_) => AuthorKind::User,
            Self::Agent => AuthorKind::Agent,
        }
    }
}

/// A unit of renderable content.
#[derive(Debug, Clone, PartialEq)]
pub enum MessagePart {
    /// Prose from the user or the agent.
    Text(String),
    /// The agent's reasoning, which a reader may want to hide by default.
    Thought(String),
    /// A tool the agent invoked.
    ToolUse(ToolUse),
    /// The agent asking to proceed.
    Permission(Permission),
}

/// A tool invocation and whatever is known about it so far.
///
/// Every field past the id is optional or defaulted, because ACP opens a tool
/// call before it knows much: the `Write` tool arrives as
/// `{"rawInput":{},"title":"Write","content":[],"locations":[]}` and is filled
/// in by later patches. A partially-known call still renders.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolUse {
    /// The ACP `toolCallId`.
    pub id: ToolUseId,
    /// What to show as the tool's name.
    ///
    /// Prefers the harness's own tool name (`Bash`, `Read`, `Write`) over
    /// ACP's coarse `kind`, since that is what a reader recognizes. Falls
    /// back to the ACP title when the harness reports nothing.
    pub label: String,
    /// Where the call got to.
    pub status: ToolStatus,
    /// What the tool did, as far as the log reveals.
    pub detail: ToolDetail,
}

/// How far a tool call progressed.
///
/// [`ToolStatus::Pending`] and [`ToolStatus::Running`] are legitimate final
/// states, not errors: a live session's newest calls have not finished, and a
/// session that dies mid-call leaves one behind permanently.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, strum::Display, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
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
/// output; an edit wants a diff; everything else wants its raw input shown as
/// JSON.
#[derive(Debug, Clone, PartialEq)]
pub enum ToolDetail {
    /// A shell command.
    Terminal {
        /// The command line, when the harness reported one.
        command: Option<String>,
        /// Captured output, ANSI escapes intact. See [`AnsiText`].
        output: Option<AnsiText>,
        /// Process exit code, when the harness reported one.
        exit_code: Option<i32>,
    },
    /// One or more file modifications.
    Edit {
        /// The diffs ACP reported for this call.
        diffs: Vec<FileDiff>,
    },
    /// A file read.
    Read {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
    },
    /// Anything else, including tools the fold has no special rendering for.
    Other {
        /// ACP's tool kind, as its wire string.
        kind: String,
        /// The tool's input, when reported.
        input: Option<serde_json::Value>,
    },
}

/// A file modification a tool reported.
#[derive(Debug, Clone, PartialEq, Eq)]
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnsiText(pub String);

impl AnsiText {
    /// The raw text, escapes included.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The agent asking permission to proceed with a tool call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Permission {
    /// The tool call permission was requested for.
    pub tool_call: ToolUseId,
    /// The choices offered, in the order ACP listed them.
    pub options: Vec<PermissionOption>,
    /// How the request has resolved so far.
    pub outcome: PermissionOutcome,
}

/// One choice offered for a [`Permission`] request.
#[derive(Debug, Clone, PartialEq, Eq)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

/// How a [`Permission`] request has resolved so far.
///
/// Not just "chosen or not": nothing chosen has more than one cause, and a
/// reader deciding whether to still show the options needs to tell them
/// apart. [`Self::Pending`] may still resolve; [`Self::Errored`] and
/// [`Self::Unrecognized`] have already resolved, just not into anything this
/// fold can show as a choice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionOutcome {
    /// No response has arrived yet - the request is still outstanding.
    Pending,
    /// An option was chosen.
    Selected {
        /// The chosen option's id.
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
/// Parsed straight off ACP's `stopReason` wire string by the strum-derived
/// [`FromStr`](std::str::FromStr): the `snake_case` variant names are the
/// wire names, and anything unmodelled falls through to [`Self::Other`], so
/// parsing never fails.
#[derive(Debug, Clone, PartialEq, Eq, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
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
    #[strum(default)]
    Other(String),
}

/// What pushing one log frame into a
/// [`FoldMachine`](crate::domain::ports::FoldMachine) changed.
///
/// Most frames change nothing - handshakes, token accounting, an unmodelled
/// update - and [`Self::Unchanged`] is what a push reports for them, rather
/// than an `Option` a caller has to unwrap before it can even ask what
/// happened. A frame changes at most one message: the only push that touches
/// two messages is a prompt arriving while a previous turn is still open, and
/// closing that turn is a no-op because its agent message is already emitted
/// with the `stop: None` it will keep.
///
/// The message is borrowed from the machine rather than cloned. Folding a
/// whole log discards every result, so cloning here would make the batch path
/// pay for the streaming one; a caller that needs to keep a message - to
/// serialize it across a WASM boundary, or to write a comms placeholder -
/// clones only the ones it uses.
///
/// [`Self::NewMessage`] and [`Self::MessageUpdate`] carry the whole message as
/// it now stands rather than a delta, so a consumer applies an update by
/// replacing whatever it holds under the same [`FoldedMessage::id`].
#[derive(Debug, Clone, PartialEq)]
pub enum IncrementalFoldResult<'a> {
    /// A message the machine had not derived before. Reported exactly once
    /// per message, before any update to it.
    NewMessage(Cow<'a, FoldedMessage>),
    /// A message the machine had already reported, whose content changed.
    MessageUpdate(Cow<'a, FoldedMessage>),
    /// The frame changed nothing renderable - a handshake, bookkeeping, or an
    /// update this fold does not model.
    Unchanged,
}

/// An incremental fold result that owns any message it carries.
pub type OwnedIncrementalFoldResult = IncrementalFoldResult<'static>;

impl IncrementalFoldResult<'_> {
    /// The message that changed, or `None` for [`Self::Unchanged`].
    #[must_use]
    pub fn message(&self) -> Option<&FoldedMessage> {
        match self {
            Self::NewMessage(message) | Self::MessageUpdate(message) => Some(message.as_ref()),
            Self::Unchanged => None,
        }
    }

    /// Own the changed message so this result can cross a task boundary.
    #[must_use]
    pub fn into_owned(self) -> OwnedIncrementalFoldResult {
        match self {
            Self::NewMessage(message) => {
                IncrementalFoldResult::NewMessage(Cow::Owned(message.into_owned()))
            }
            Self::MessageUpdate(message) => {
                IncrementalFoldResult::MessageUpdate(Cow::Owned(message.into_owned()))
            }
            Self::Unchanged => IncrementalFoldResult::Unchanged,
        }
    }
}
