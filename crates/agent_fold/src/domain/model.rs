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
use std::path::PathBuf;

/// One prompt-to-stop cycle within a session.
///
/// Assigned by the fold in log order starting at zero, so the same log always
/// yields the same ids. This is not the ACP request id - that correlation is
/// internal to the fold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MessageId {
    /// The turn the message belongs to.
    pub turn: TurnId,
    /// Which side of the conversation produced it.
    pub author: AuthorKind,
}

/// Which side of the conversation produced a message.
///
/// The identity-free discriminant of [`Author`], usable in a key where
/// [`Author`] itself carries a payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AuthorKind {
    /// A person.
    User,
    /// The agent.
    Agent,
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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
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
    /// What the user chose.
    ///
    /// `None` while the request is outstanding, or when the session ended
    /// before anyone answered.
    pub outcome: Option<PermissionOutcome>,
}

/// One choice offered for a [`Permission`] request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionOption {
    /// The id to report back when this option is chosen.
    pub id: String,
    /// Label to show.
    pub name: String,
    /// ACP's option kind, as its wire string - `allow_once`, `reject_once`,
    /// `allow_always`, `reject_always`.
    pub kind: String,
}

/// How a [`Permission`] request resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionOutcome {
    /// An option was chosen.
    Selected {
        /// The chosen option's id.
        option_id: String,
    },
    /// The request was cancelled without a choice.
    Cancelled,
}

/// Why a turn stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
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
    Other(String),
}
