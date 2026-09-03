//! Tool calls: what one was called, how far it got, and what it did.

use std::convert::Infallible;
use std::path::PathBuf;
use std::str::FromStr;

use agent_client_protocol::schema::v1::ToolCallStatus;
use lazy_regex::regex_captures;
use serde::Serialize;
use specta::Type;

use super::part::MessagePart;
use super::subagent::SubagentResult;
use super::user_tool::UserToolOutcome;

/// What a harness called a tool.
///
/// ACP has no tool-name field - a call carries a human-readable `title` and a
/// coarse `kind`, nothing more. The name a reader wants (`Bash`, `ReadContent`)
/// is a harness convention: Claude Code writes it to `_meta`, others put it
/// in the title, and tools reached over MCP arrive namespaced as
/// `mcp__<server>__<tool>`. This type is the one place that namespacing is
/// understood, so no reader downstream ever splits a string.
///
/// Parsing is infallible: a string that is not an MCP name is a native one,
/// however odd it looks. Nothing is dropped for being unrecognized.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolName {
    /// A tool the harness owns: `Bash`, `Read`, `Write`, or a Macro tool
    /// called in-process by Macro's own agent.
    Native {
        /// The name as the harness reported it.
        name: String,
    },
    /// A tool reached over MCP, from the server the harness registered it
    /// under.
    Mcp {
        /// The MCP server's name, as the harness registered it.
        server: String,
        /// The tool's name on that server.
        tool: String,
    },
}

impl ToolName {
    /// A native name, as reported.
    #[must_use]
    pub fn native(name: impl Into<String>) -> Self {
        Self::Native { name: name.into() }
    }

    /// The short name to show: the tool's own name, without any server
    /// namespacing.
    #[must_use]
    pub fn display(&self) -> &str {
        match self {
            Self::Native { name } => name,
            Self::Mcp { tool, .. } => tool,
        }
    }

    /// Whether this name is empty - a call whose harness reported nothing
    /// useful yet, which a later patch may fill in.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.display().is_empty()
    }
}

impl FromStr for ToolName {
    type Err = Infallible;

    /// `mcp__<server>__<tool>` splits at the first `__` after the prefix
    /// whose left side does not start or end in an underscore, so a server
    /// or tool name containing single underscores survives intact. Anything
    /// else is a native name.
    fn from_str(name: &str) -> Result<Self, Self::Err> {
        Ok(
            match regex_captures!(r"^mcp__([^_](?:.*?[^_])?)__(.+)$", name) {
                Some((_, server, tool)) => Self::Mcp {
                    server: server.to_owned(),
                    tool: tool.to_owned(),
                },
                None => Self::Native {
                    name: name.to_owned(),
                },
            },
        )
    }
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

impl ToolStatus {
    /// Whether the call is over, either way.
    #[must_use]
    pub const fn is_finished(self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }
}

impl From<ToolCallStatus> for ToolStatus {
    fn from(status: ToolCallStatus) -> Self {
        match status {
            ToolCallStatus::Pending => Self::Pending,
            ToolCallStatus::InProgress => Self::Running,
            ToolCallStatus::Completed => Self::Completed,
            ToolCallStatus::Failed => Self::Failed,
            // `ToolCallStatus` is `#[non_exhaustive]`; an unknown status has
            // not demonstrably finished.
            _ => Self::Pending,
        }
    }
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
///
/// Three variants are chosen by *name* rather than kind: Macro's own tools
/// ([`Self::Macro`], [`Self::UserTool`]) arrive as ACP `other`, and what a
/// reader wants for them is the tool's own JSON, not a generic card; a
/// delegation ([`Self::Subagent`]) is a tool call by whatever name its
/// harness gives it. The harness layer decides which names are which.
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
    /// A Macro tool the fold knows by name - reached over Macro's MCP
    /// server, or called in-process by Macro's own agent. Input and output
    /// are the tool's own JSON, any MCP envelope already removed, so a
    /// reader that knows the tool renders it without parsing the wire.
    Macro {
        /// The tool's arguments, as it defines them.
        #[specta(type = specta_typescript::Unknown)]
        input: serde_json::Value,
        /// The tool's result, as it defines it; absent until the call
        /// completes.
        #[specta(type = specta_typescript::Unknown)]
        output: Option<serde_json::Value>,
        /// The error text, when the call failed.
        error: Option<String>,
    },
    /// A Macro user tool: the agent drafted it, the user finishes it after
    /// the turn. See [`UserToolOutcome`].
    UserTool {
        /// The draft, as the tool defines its arguments; patched as the
        /// user edits.
        #[specta(type = specta_typescript::Unknown)]
        input: serde_json::Value,
        /// Where the user got to with it.
        outcome: UserToolOutcome,
    },
    /// Work the agent delegated to another agent.
    ///
    /// ACP has no notion of this; every harness spells it as a tool call by
    /// its own conventions (Claude Code's `Agent`, OpenCode's and Cursor's
    /// `task`, Codex's `spawnAgent`, Hermes's `delegate_task`), and the
    /// harness reader recognizes it. What the subagent itself did nests in
    /// `children` when the harness attributes its calls to the parent -
    /// only Claude Code does today - and is otherwise summarized in
    /// `result`.
    Subagent {
        /// What to call the delegation: the harness's description when it
        /// gave one, else the first line of the brief, else the tool's own
        /// name. Always present, so a reader never has to pick a fallback
        /// itself; `description` and `prompt` stay exactly what the harness
        /// said.
        title: String,
        /// Which kind of agent was delegated to (`general-purpose`,
        /// `explore`), when the harness names one.
        #[serde(rename = "agentType")]
        agent_type: Option<String>,
        /// A short description of the task, when given.
        description: Option<String>,
        /// The brief the subagent was given.
        prompt: Option<String>,
        /// Whether the subagent was started in the background: its call
        /// completes at once and its answer, if any, arrives some other way.
        background: bool,
        /// The subagent's own parts, in arrival order, for a harness that
        /// attributes them to the parent call.
        children: Vec<MessagePart>,
        /// What the subagent reported back, once it has.
        ///
        /// Boxed: this is by far the widest thing a part can hold, and every
        /// part pays for the widest variant.
        result: Option<Box<SubagentResult>>,
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
