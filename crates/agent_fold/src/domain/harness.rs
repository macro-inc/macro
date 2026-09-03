//! Harness-specific conventions: who produced the log, and how to read what
//! they wrote beyond the ACP schema.
//!
//! ACP reserves `_meta` for implementation-defined data and tells clients to
//! make no assumptions about it. A faithful fold nevertheless has to read it,
//! because the material a reader most wants is only there:
//!
//! - The real tool name (`Bash`, `Read`, `Write`). ACP normalizes tools to a
//!   coarse [`ToolKind`](agent_client_protocol::ToolKind), so `execute` is all
//!   the spec gives us.
//! - Terminal output and exit codes. ACP's own
//!   [`Terminal`](agent_client_protocol::Terminal) content block carries only
//!   a `terminalId` pointing at a terminal the client is expected to have
//!   created itself. A fold reading a historical log never created one, so the
//!   only output it will ever see is the copy in `_meta`.
//!
//! Each harness writes these differently, so each gets a [`HarnessReader`]
//! in its own file, and the fold reads `_meta` through
//! [`Harness::reader`] and nowhere else. Every method has a harness-neutral
//! default in [`generic`], so an unknown harness still folds; a known one
//! overrides only what it can answer from its own conventions. Every reader
//! treats a missing or misshapen key as "no information".
//!
//! Two things a tool call carries are not the harness's to define, and have
//! modules of their own rather than a reader:
//!
//! - [`mcp`] - the envelope MCP wraps every external tool's result in, which
//!   a harness may copy into `rawOutput` whole.
//! - [`macro_tools`] - Macro's own tools, which any harness may call (over
//!   Macro's MCP server, or natively when the harness *is* Macro's agent).
//!   Their names and result shapes are Macro's whichever harness relayed
//!   them.
//!
//! The fold reads a call through the functions at the bottom of this file -
//! [`tool_shape`], [`subagent_result`], [`user_tool_outcome`] - which decide
//! whose shape a call is in and read it accordingly, so the fold itself
//! never names a harness, MCP, or a Macro tool.
//!
//! Supporting a new harness is one file here, one arm in
//! [`Harness::reader`], and one row in [`Harness::from_agent_info`].

/// The Claude Code harness (`claude-agent-acp`).
pub mod claude_code;
/// OpenAI Codex through `codex-acp`.
pub mod codex;
/// Cursor cloud agents through `cursor_cloud_agents`.
pub mod cursor;
/// Harness-neutral defaults.
pub mod generic;
/// Nous Research's Hermes agent.
pub mod hermes;
/// Macro's own in-process agent (`agent_inmem`).
pub mod macro_inmem;
/// Macro's tools: their names and what they return.
pub mod macro_tools;
/// MCP's result envelope.
pub mod mcp;
/// OpenClaw's ACP gateway.
pub mod openclaw;
/// OpenCode's built-in ACP server.
pub mod opencode;

use crate::domain::model::{
    Harness, MessagePart, SubagentResult, ToolName, ToolUseId, UserToolOutcome,
};
use agent_client_protocol::schema::v1::{Meta, ToolKind};
use lazy_regex::regex_is_match;
use macro_tools::MacroTool;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

/// What a harness's conventions let the fold read off a tool frame.
///
/// Every method has a default a harness can leave alone. Defaults are the
/// neutral readings in [`generic`], never `None`-for-everything: a frame
/// from an unrecognized harness still folds to the same vocabulary as one
/// from a known harness, only with less filled in.
pub trait HarnessReader: Sync {
    /// The `_meta` namespace this harness writes its own keys under, when it
    /// has one - `claudeCode`, `macro`. Used to recognize a harness from a
    /// tool frame when the log has no `initialize` to read.
    fn meta_namespace(&self) -> Option<&'static str> {
        None
    }

    /// The tool's own name, when the harness reported one beyond the bare
    /// ACP title - in `_meta`, or by a naming convention in the title.
    ///
    /// Outranks the plain title, which is human-readable copy and may change
    /// over a call's life. `None` means the title is all there is.
    fn harness_tool_name(&self, meta: Option<&Meta>, title: &str) -> Option<ToolName> {
        let _ = (meta, title);
        None
    }

    /// Terminal output accumulated so far, from `_meta`.
    fn terminal_output(&self, meta: Option<&Meta>) -> Option<String> {
        generic::terminal_output(meta)
    }

    /// The exit code a terminal-backed call finished with, from `_meta`.
    fn terminal_exit_code(&self, meta: Option<&Meta>) -> Option<i32> {
        generic::terminal_exit_code(meta)
    }

    /// The Macro tool `name` refers to, if it is one of Macro's.
    ///
    /// For most harnesses that means a tool reached over Macro's own MCP
    /// server; Macro's in-process agent calls the same tools natively and
    /// says so by being the harness it is.
    fn macro_tool<'name>(&self, name: &'name ToolName) -> Option<&'name str> {
        macro_tools::mcp_tool(name)
    }

    /// An external tool's own result, out of whatever this harness wrapped it
    /// in when it wrote `rawOutput`, plus the error text when the wrapper
    /// reported failure. The neutral reading is MCP's envelope.
    fn unwrap_tool_output(&self, raw: &Value) -> (Value, Option<String>) {
        mcp::unwrap_call_result(raw)
    }

    /// Whether a call, as its opening frame describes it, delegates work to
    /// another agent.
    ///
    /// Decided at open and never revisited, so a subagent never changes
    /// shape mid-flight. The neutral rule is the Claude Code "Task tool"
    /// convention that OpenCode and Cursor copied: a tool called `task` or
    /// `agent` whose kind is `think` or `other`.
    fn is_subagent(&self, name: &ToolName, kind: ToolKind, meta: Option<&Meta>) -> bool {
        let _ = meta;
        generic::is_subagent(name, kind)
    }

    /// The subagent call this frame's call belongs to, when the harness
    /// attributes calls to a parent. Only Claude Code does today.
    fn parent_tool_call(&self, meta: Option<&Meta>) -> Option<ToolUseId> {
        let _ = meta;
        None
    }

    /// What a subagent was asked, read off a call's raw input (and, for a
    /// harness that puts it nowhere else, its title).
    fn subagent_input(&self, raw_input: Option<&serde_json::Value>, title: &str) -> SubagentInput {
        let _ = title;
        generic::subagent_input(raw_input)
    }

    /// What a subagent reported, read off a frame's `_meta`, raw input, raw
    /// output and content text - whichever of those the harness uses.
    /// `None` when the frame carries no result at all.
    fn subagent_result(
        &self,
        meta: Option<&Meta>,
        raw_input: Option<&serde_json::Value>,
        raw_output: Option<&serde_json::Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        let _ = (meta, raw_input);
        generic::subagent_result(raw_output, content_text)
    }

    /// The subagent's own activity, when the harness reports it wholesale in
    /// the call's result rather than streaming the child's frames and
    /// attributing them to the parent (see [`Self::parent_tool_call`]).
    /// Only Cursor does today. Empty means the frame carries none; a
    /// non-empty transcript replaces whatever children the call held.
    fn subagent_transcript(&self, raw_output: Option<&serde_json::Value>) -> Vec<MessagePart> {
        let _ = raw_output;
        Vec::new()
    }
}

/// What a subagent was asked, as one frame reports it. Every field is
/// optional because the input arrives in pieces - Claude Code streams the
/// arguments over several patches - and a patch only says what it carries.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SubagentInput {
    /// Which kind of agent was delegated to.
    pub agent_type: Option<String>,
    /// A short description of the task.
    pub description: Option<String>,
    /// The brief.
    pub prompt: Option<String>,
    /// Whether the subagent runs in the background.
    pub background: Option<bool>,
}

impl Harness {
    /// Recognize a harness from the `agentInfo.name` it announced in its
    /// `initialize` response: the first known harness whose name matches.
    #[must_use]
    pub fn from_agent_info(name: &str) -> Self {
        Self::KNOWN
            .iter()
            .copied()
            .find(|harness| harness.name_matches(name))
            .unwrap_or(Self::Unknown)
    }

    /// Whether `name` - an `agentInfo.name` - is this harness announcing
    /// itself.
    ///
    /// Matching is loose on purpose: a harness's package name, title and
    /// version format all change more often than the word that identifies
    /// it, so each harness matches that word. [`Self::Unknown`] matches
    /// nothing; it is what is left when no harness does.
    #[must_use]
    pub fn name_matches(self, name: &str) -> bool {
        match self {
            Self::ClaudeCode => regex_is_match!(r"(?i)claude", name),
            Self::OpenCode => regex_is_match!(r"(?i)^opencode", name),
            Self::Codex => regex_is_match!(r"(?i)codex", name),
            Self::Cursor => regex_is_match!(r"(?i)cursor", name),
            Self::Macro => regex_is_match!(r"(?i)^macro", name),
            Self::Hermes => regex_is_match!(r"(?i)hermes", name),
            Self::OpenClaw => regex_is_match!(r"(?i)openclaw", name),
            Self::Unknown => false,
        }
    }

    /// Recognize a harness from the `_meta` namespaces on a tool frame, for
    /// a log with no `initialize` to read - a session that was resumed, or a
    /// recording that starts mid-turn. `None` when nothing on the frame
    /// names one.
    #[must_use]
    pub fn sniff_meta(meta: Option<&Meta>) -> Option<Self> {
        let meta = meta?;
        Self::KNOWN.iter().copied().find(|harness| {
            harness
                .reader()
                .meta_namespace()
                .is_some_and(|namespace| meta.contains_key(namespace))
        })
    }

    /// Every harness with a reader of its own, in the order recognition
    /// tries them - by announced name, then by `_meta` namespace. Harnesses
    /// that write no `_meta` namespace on tool frames (OpenCode, Cursor,
    /// Hermes, OpenClaw) can only be recognized from `initialize`.
    const KNOWN: &'static [Self] = &[
        Self::ClaudeCode,
        Self::Macro,
        Self::Codex,
        Self::OpenCode,
        Self::Cursor,
        Self::Hermes,
        Self::OpenClaw,
    ];

    /// How to read this harness's frames.
    #[must_use]
    pub fn reader(self) -> &'static dyn HarnessReader {
        match self {
            Self::ClaudeCode => &claude_code::ClaudeCode,
            Self::Macro => &macro_inmem::MacroInmem,
            Self::OpenCode => &opencode::OpenCode,
            Self::Codex => &codex::Codex,
            Self::Cursor => &cursor::Cursor,
            Self::Hermes => &hermes::Hermes,
            Self::OpenClaw => &openclaw::OpenClaw,
            Self::Unknown => &generic::Generic,
        }
    }
}

/// The name of the tool behind a `tool_call`'s opening frame: the harness's
/// own name when it wrote one to `_meta`, else the ACP title.
#[must_use]
pub fn tool_name(reader: &dyn HarnessReader, meta: Option<&Meta>, title: &str) -> ToolName {
    reader
        .harness_tool_name(meta, title)
        .unwrap_or_else(|| title.parse().unwrap_or_else(|never| match never {}))
}

/// Whose shape a tool call is in, and so how the fold reads it.
///
/// Decided once, from the opening frame, and never revisited: the detail a
/// call opens with is the detail it keeps, so a subagent never turns into a
/// Macro tool mid-flight or the other way round.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolShape<'name> {
    /// One of the harness's own tools, read by its ACP kind: `Bash`, `Read`,
    /// `Write`, or a tool from an MCP server the fold knows nothing about.
    Harness,
    /// A Macro tool, by the name Macro gives it. Its input and output are the
    /// tool's own JSON once the harness's wrapper is off.
    Macro(&'name str),
    /// A Macro user tool, by name: the agent drafts it, the user finishes it.
    UserTool(&'name str),
    /// Work delegated to another agent - the harness's own delegation tool
    /// (Claude Code's `Agent`, Cursor's `task`) or Macro's `Subagent`. Which
    /// of the two it is stays out of the fold's way: [`subagent_result`]
    /// reads either by the tool's name.
    Subagent,
}

/// Classify a tool call from its opening frame.
///
/// Macro's tools are recognized by name before anything else, since the
/// kind ACP gives them is `other` and says nothing; among them, `Subagent`
/// is a delegation like the harness's own. Everything else is the harness's,
/// and whether it delegates is the reader's call.
#[must_use]
pub fn tool_shape<'name>(
    reader: &dyn HarnessReader,
    name: &'name ToolName,
    kind: ToolKind,
    meta: Option<&Meta>,
) -> ToolShape<'name> {
    match reader.macro_tool(name).map(MacroTool::of) {
        Some(MacroTool::User(tool)) => ToolShape::UserTool(tool),
        Some(MacroTool::Subagent) => ToolShape::Subagent,
        Some(MacroTool::Other(tool)) => ToolShape::Macro(tool),
        None if reader.is_subagent(name, kind, meta) => ToolShape::Subagent,
        None => ToolShape::Harness,
    }
}

/// What a subagent reported on one frame, read in whichever shape the
/// delegation tool named by `name` answers in: Macro's `Subagent` returns
/// Macro's response inside the harness's wrapper, whoever the harness is;
/// any other delegation tool is the harness's own, and its reader knows it.
/// `None` when the frame carries no result.
#[must_use]
pub fn subagent_result(
    reader: &dyn HarnessReader,
    name: &ToolName,
    meta: Option<&Meta>,
    raw_input: Option<&Value>,
    raw_output: Option<&Value>,
    content_text: Option<&str>,
) -> Option<SubagentResult> {
    if reader.macro_tool(name).map(MacroTool::of) == Some(MacroTool::Subagent) {
        let (value, error) = reader.unwrap_tool_output(raw_output?);
        return macro_tools::subagent_result(&value, error);
    }
    reader.subagent_result(meta, raw_input, raw_output, content_text)
}

/// Where a Macro user tool got to, from a frame's `rawOutput`: the harness's
/// wrapper reporting failure is [`UserToolOutcome::Failed`]; otherwise the
/// response inside it says.
#[must_use]
pub fn user_tool_outcome(
    reader: &dyn HarnessReader,
    tool: &str,
    raw_output: &Value,
) -> UserToolOutcome {
    match reader.unwrap_tool_output(raw_output) {
        (_, Some(error)) => UserToolOutcome::Failed { message: error },
        (value, None) => macro_tools::user_tool_outcome(tool, &value),
    }
}

/// The object at `_meta.<namespace>`, read as `T`.
///
/// The shape every namespaced harness shares: its keys live under one
/// top-level object named for the harness. `None` when the key is absent,
/// not an object, or does not deserialize - all "no information".
#[must_use]
pub(crate) fn namespaced<T: DeserializeOwned>(meta: Option<&Meta>, namespace: &str) -> Option<T> {
    let value = meta?.get(namespace)?;
    value
        .is_object()
        .then(|| serde_json::from_value(value.clone()).ok())
        .flatten()
}

/// `raw_input` or `raw_output`, read as `T`. `None` when absent or not that
/// shape.
#[must_use]
pub(crate) fn raw<T: DeserializeOwned>(value: Option<&serde_json::Value>) -> Option<T> {
    serde_json::from_value(value?.clone()).ok()
}

/// The command line behind an `execute` tool call.
///
/// This one reads ACP's own `rawInput` rather than `_meta`, but lives here
/// because the key it looks for (`command`) is a harness convention that ACP
/// does not specify.
#[must_use]
pub fn command_from_raw_input(raw_input: Option<&serde_json::Value>) -> Option<String> {
    #[derive(Deserialize)]
    struct Input {
        command: Option<String>,
    }
    raw::<Input>(raw_input)?.command
}

/// The whole-file edit an edit tool's raw input describes, as
/// `(path, new contents)`.
///
/// Claude Code's `Write` (and whole-file `Edit`) calls carry
/// `{"filePath", "content"}` in `rawInput` and never report an ACP diff
/// content block, so this is the only material a fold has for their diff. The
/// prior contents are not on the wire at all — a reader treats the file as
/// new.
#[must_use]
pub fn file_edit_from_raw_input(raw_input: Option<&serde_json::Value>) -> Option<(String, String)> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Input {
        file_path: String,
        content: String,
    }
    let input: Input = raw(raw_input)?;
    Some((input.file_path, input.content))
}
