//! Harness-specific conventions: who produced the log, and how to read what
//! they wrote beyond the ACP schema.
//!
//! ACP gives a tool call a human-readable `title`, a coarse
//! [`ToolKind`](agent_client_protocol::ToolKind), typed content blocks, and
//! three fields it deliberately leaves open: `rawInput`, `rawOutput`, and
//! `_meta`. The material a reader most wants lives in those open fields, by
//! each harness's own convention:
//!
//! - The real tool name (`Bash`, `Read`, `Write`). Claude Code writes it to
//!   `_meta`; Codex spells MCP tools into the title; OpenClaw prefixes the
//!   title with it.
//! - Terminal output and exit codes. ACP's own
//!   [`Terminal`](agent_client_protocol::Terminal) content block carries only
//!   a `terminalId` pointing at a terminal the client is expected to have
//!   created itself. A fold reading a historical log never created one, so the
//!   only output it will ever see is the copy in `_meta`.
//! - Whether a call delegates to another agent, and what that agent said.
//!   Every harness spells this differently: a `_meta` flag, a tool name, a
//!   title prefix; the answer in `_meta`, in `rawInput`, in `rawOutput`, or
//!   in the content text.
//!
//! So each harness gets a [`HarnessReader`] in its own file, and every reader
//! method takes the whole frame - a [`ToolFrame`] - rather than the fields
//! some earlier harness happened to need. A harness that answers a question
//! from a field no other harness uses reads it off the frame; the trait does
//! not change. Every method has a harness-neutral default in [`generic`], so
//! an unknown harness still folds; a known one overrides only what it can
//! answer from its own conventions. Every reader treats a missing or
//! misshapen field as "no information".
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
//! [`tool_name`], [`tool_shape`], [`subagent_result`], [`user_tool_outcome`]
//! - which decide whose shape a call is in and read it accordingly, so the
//! fold itself never names a harness, MCP, or a Macro tool.
//!
//! Supporting a new harness is one file here and one arm in
//! [`Harness::reader`]. The reader says how to recognize itself
//! ([`HarnessReader::announces`], [`HarnessReader::wrote`]) as well as how
//! to read its frames.

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
    Harness, MessagePart, SubagentResult, ToolName, ToolStatus, ToolUseId, UserToolOutcome,
};
use agent_client_protocol::schema::v1::{
    Content, ContentBlock, Meta, ToolCall, ToolCallContent, ToolCallLocation, ToolCallUpdate,
    ToolKind,
};
use macro_tools::MacroTool;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

/// One tool frame, as a harness reads it: everything a `tool_call` or a
/// `tool_call_update` carries, borrowed.
///
/// A `tool_call` fills every field it has; an update fills only what it
/// patches, so every field is optional and a reader treats an absent one as
/// "not on this frame". Readers take this whole rather than a hand-picked
/// subset of it, so a harness that answers a question from a field no other
/// harness uses needs no change to the trait.
#[derive(Debug, Clone, Copy, Default)]
pub struct ToolFrame<'frame> {
    /// ACP's implementation-defined `_meta`.
    pub meta: Option<&'frame Meta>,
    /// The human-readable title.
    pub title: Option<&'frame str>,
    /// ACP's coarse kind.
    pub kind: Option<ToolKind>,
    /// How far the call has got. On an update, the status the call is in
    /// once the update is applied - the update's own when it carries one,
    /// else the status held before it (see [`Self::with_status`]).
    pub status: Option<ToolStatus>,
    /// The tool's arguments, in the harness's shape.
    pub raw_input: Option<&'frame Value>,
    /// The tool's result, in the harness's shape.
    pub raw_output: Option<&'frame Value>,
    /// The typed content blocks.
    pub content: Option<&'frame [ToolCallContent]>,
    /// The paths the call touched.
    pub locations: Option<&'frame [ToolCallLocation]>,
}

impl<'frame> ToolFrame<'frame> {
    /// The view of an opening `tool_call`.
    #[must_use]
    pub fn of_call(call: &'frame ToolCall) -> Self {
        Self {
            meta: call.meta.as_ref(),
            title: Some(&call.title),
            kind: Some(call.kind),
            status: Some(call.status.into()),
            raw_input: call.raw_input.as_ref(),
            raw_output: call.raw_output.as_ref(),
            content: Some(&call.content),
            locations: Some(&call.locations),
        }
    }

    /// The view of a `tool_call_update`: only what it carries.
    #[must_use]
    pub fn of_update(update: &'frame ToolCallUpdate) -> Self {
        let fields = &update.fields;
        Self {
            meta: update.meta.as_ref(),
            title: fields.title.as_deref(),
            kind: fields.kind,
            status: fields.status.map(Into::into),
            raw_input: fields.raw_input.as_ref(),
            raw_output: fields.raw_output.as_ref(),
            content: fields.content.as_deref(),
            locations: fields.locations.as_deref(),
        }
    }

    /// The same frame with the status the call is in once it is applied,
    /// for an update that carried none of its own.
    #[must_use]
    pub fn with_status(self, status: ToolStatus) -> Self {
        Self {
            status: Some(status),
            ..self
        }
    }

    /// Whether the call is over, as far as this frame says.
    #[must_use]
    pub fn finished(&self) -> bool {
        self.status.is_some_and(ToolStatus::is_finished)
    }

    /// The text among the content blocks - e.g. search matches or a fetched
    /// page's text - joined in order. `None` when no block carries text,
    /// same as an empty result: nothing useful distinguishes "reported
    /// nothing" from "reported an empty string".
    #[must_use]
    pub fn content_text(&self) -> Option<String> {
        let text = self
            .content?
            .iter()
            .filter_map(|block| match block {
                ToolCallContent::Content(Content {
                    content: ContentBlock::Text(text),
                    ..
                }) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<String>();
        (!text.is_empty()).then_some(text)
    }
}

/// What a harness's conventions let the fold read off a tool frame, and how
/// the fold tells which harness it is reading.
///
/// Every method has a default a harness can leave alone. Defaults are the
/// neutral readings in [`generic`], never `None`-for-everything: a frame
/// from an unrecognized harness still folds to the same vocabulary as one
/// from a known harness, only with less filled in.
pub trait HarnessReader: Sync {
    /// Whether `name` - the `agentInfo.name` an `initialize` response
    /// announced - is this harness. Matching should be loose: a harness's
    /// package name, title and version format all change more often than
    /// the word that identifies it.
    fn announces(&self, name: &str) -> bool {
        let _ = name;
        false
    }

    /// Whether this harness wrote `frame` - for a log with no `initialize`
    /// to read (a resumed session, a recording that starts mid-turn). Only a
    /// harness that leaves something distinctive on its tool frames, like a
    /// `_meta` namespace of its own, can say yes.
    fn wrote(&self, frame: &ToolFrame<'_>) -> bool {
        let _ = frame;
        false
    }

    /// The tool's own name, when the harness reported one beyond the bare
    /// ACP title - in `_meta`, or by a naming convention in the title.
    ///
    /// Outranks the plain title, which is human-readable copy and may change
    /// over a call's life. `None` means the title is all there is. Returns a
    /// [`ToolName`] rather than a string because splitting an MCP tool's
    /// server from its name is itself a harness convention.
    fn reported_tool_name(&self, frame: &ToolFrame<'_>) -> Option<ToolName> {
        let _ = frame;
        None
    }

    /// Terminal output accumulated so far.
    fn terminal_output(&self, frame: &ToolFrame<'_>) -> Option<String> {
        generic::terminal_output(frame)
    }

    /// The exit code a terminal-backed call finished with.
    fn terminal_exit_code(&self, frame: &ToolFrame<'_>) -> Option<i32> {
        generic::terminal_exit_code(frame)
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
    fn is_subagent(&self, name: &ToolName, frame: &ToolFrame<'_>) -> bool {
        generic::is_subagent(name, frame)
    }

    /// The subagent call this frame's call belongs to, when the harness
    /// attributes calls to a parent. Only Claude Code does today.
    fn parent_tool_call(&self, frame: &ToolFrame<'_>) -> Option<ToolUseId> {
        let _ = frame;
        None
    }

    /// What a subagent was asked.
    fn subagent_input(&self, frame: &ToolFrame<'_>) -> SubagentInput {
        generic::subagent_input(frame)
    }

    /// What a subagent reported on this frame, wherever the harness puts it.
    /// `None` when the frame carries no result at all.
    fn subagent_result(&self, frame: &ToolFrame<'_>) -> Option<SubagentResult> {
        generic::subagent_result(frame)
    }

    /// The subagent's own activity, when the harness reports it wholesale in
    /// the call's result rather than streaming the child's frames and
    /// attributing them to the parent (see [`Self::parent_tool_call`]).
    /// Only Cursor does today. Empty means the frame carries none; a
    /// non-empty transcript replaces whatever children the call held.
    fn subagent_transcript(&self, frame: &ToolFrame<'_>) -> Vec<MessagePart> {
        let _ = frame;
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
    /// `initialize` response: the first known harness that claims the name.
    #[must_use]
    pub fn from_agent_info(name: &str) -> Self {
        Self::KNOWN
            .iter()
            .copied()
            .find(|harness| harness.reader().announces(name))
            .unwrap_or(Self::Unknown)
    }

    /// Recognize a harness from a tool frame, for a log with no `initialize`
    /// to read. `None` when no known harness claims the frame.
    #[must_use]
    pub fn sniff(frame: &ToolFrame<'_>) -> Option<Self> {
        Self::KNOWN
            .iter()
            .copied()
            .find(|harness| harness.reader().wrote(frame))
    }

    /// Every harness with a reader of its own, in the order recognition
    /// tries them.
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

/// The name of the tool behind a frame: the harness's own name when it
/// reported one, else the ACP title, else empty - a name a later patch may
/// fill.
#[must_use]
pub fn tool_name(reader: &dyn HarnessReader, frame: &ToolFrame<'_>) -> ToolName {
    reader.reported_tool_name(frame).unwrap_or_else(|| {
        frame
            .title
            .unwrap_or_default()
            .parse()
            .unwrap_or_else(|never| match never {})
    })
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
    frame: &ToolFrame<'_>,
) -> ToolShape<'name> {
    match reader.macro_tool(name).map(MacroTool::of) {
        Some(MacroTool::User(tool)) => ToolShape::UserTool(tool),
        Some(MacroTool::Subagent) => ToolShape::Subagent,
        Some(MacroTool::Other(tool)) => ToolShape::Macro(tool),
        None if reader.is_subagent(name, frame) => ToolShape::Subagent,
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
    frame: &ToolFrame<'_>,
) -> Option<SubagentResult> {
    if reader.macro_tool(name).map(MacroTool::of) == Some(MacroTool::Subagent) {
        let (value, error) = reader.unwrap_tool_output(frame.raw_output?);
        return macro_tools::subagent_result(&value, error);
    }
    reader.subagent_result(frame)
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

/// Whether `_meta` has a key called `namespace` at all - how a harness that
/// writes one recognizes its own frames.
#[must_use]
pub(crate) fn has_namespace(meta: Option<&Meta>, namespace: &str) -> bool {
    meta.is_some_and(|meta| meta.contains_key(namespace))
}

/// `raw_input` or `raw_output`, read as `T`. `None` when absent or not that
/// shape.
#[must_use]
pub(crate) fn raw<T: DeserializeOwned>(value: Option<&Value>) -> Option<T> {
    serde_json::from_value(value?.clone()).ok()
}

/// The command line behind an `execute` tool call.
///
/// This one reads ACP's own `rawInput` rather than `_meta`, but lives here
/// because the key it looks for (`command`) is a harness convention that ACP
/// does not specify.
#[must_use]
pub fn command_from_raw_input(raw_input: Option<&Value>) -> Option<String> {
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
pub fn file_edit_from_raw_input(raw_input: Option<&Value>) -> Option<(String, String)> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Input {
        file_path: String,
        content: String,
    }
    let input: Input = raw(raw_input)?;
    Some((input.file_path, input.content))
}
