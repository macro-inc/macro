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
/// MCP's result and user-tool response shapes.
pub mod mcp;
/// OpenClaw's ACP gateway.
pub mod openclaw;
/// OpenCode's built-in ACP server.
pub mod opencode;

use crate::domain::model::{Harness, SubagentResult, ToolName, ToolUseId};
use agent_client_protocol::schema::v1::{Meta, ToolKind};
use lazy_regex::regex_is_match;

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
        name.macro_mcp_tool()
    }

    /// A Macro tool's own result, out of whatever `rawOutput` wrapped it in,
    /// plus the error text when the wrapper reported failure.
    fn unwrap_tool_output(&self, raw: &serde_json::Value) -> (serde_json::Value, Option<String>) {
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
    /// `initialize` response.
    ///
    /// Matching is loose on purpose: a harness's package name, title and
    /// version format all change more often than the word that identifies
    /// it, so each row matches that word.
    #[must_use]
    pub fn from_agent_info(name: &str) -> Self {
        if regex_is_match!(r"(?i)claude", name) {
            Self::ClaudeCode
        } else if regex_is_match!(r"(?i)^opencode", name) {
            Self::OpenCode
        } else if regex_is_match!(r"(?i)codex", name) {
            Self::Codex
        } else if regex_is_match!(r"(?i)cursor", name) {
            Self::Cursor
        } else if regex_is_match!(r"(?i)^macro", name) {
            Self::Macro
        } else if regex_is_match!(r"(?i)hermes", name) {
            Self::Hermes
        } else if regex_is_match!(r"(?i)openclaw", name) {
            Self::OpenClaw
        } else {
            Self::Unknown
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

    /// Every harness with a reader of its own, in the order a sniff tries
    /// them. Harnesses that write no `_meta` namespace on tool frames
    /// (OpenCode, Cursor, Hermes, OpenClaw) can only be recognized from
    /// `initialize`.
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

/// The value at `_meta.<namespace>`, when it is an object.
///
/// The shape every namespaced harness shares: its keys live under one
/// top-level object named for the harness.
#[must_use]
pub(crate) fn namespace<'meta>(
    meta: Option<&'meta Meta>,
    namespace: &str,
) -> Option<&'meta serde_json::Map<String, serde_json::Value>> {
    meta?.get(namespace)?.as_object()
}

/// The command line behind an `execute` tool call.
///
/// This one reads ACP's own `rawInput` rather than `_meta`, but lives here
/// because the key it looks for (`command`) is a harness convention that ACP
/// does not specify.
#[must_use]
pub fn command_from_raw_input(raw_input: Option<&serde_json::Value>) -> Option<String> {
    raw_input?.get("command")?.as_str().map(ToOwned::to_owned)
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
    let input = raw_input?;
    let path = input.get("filePath")?.as_str()?;
    let content = input.get("content")?.as_str()?;
    Some((path.to_owned(), content.to_owned()))
}
