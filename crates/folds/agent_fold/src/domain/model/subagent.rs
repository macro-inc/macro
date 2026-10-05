//! Delegated agents: what a subagent was asked, what it did, what it said.

use serde::Serialize;
use specta::Type;

/// What a subagent reported back, as far as its harness told us.
///
/// Every field is optional because every harness tells us a different
/// subset: Claude Code reports timings, token counts and a per-tool
/// breakdown; OpenCode names the child session and its model; Cursor and
/// Hermes give back little more than the text. A reader shows what is
/// there.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubagentResult {
    /// The subagent's answer, as text.
    pub text: Option<String>,
    /// Why the subagent failed, when it did.
    pub error: Option<String>,
    /// The harness's id for the subagent or its session, for anyone who
    /// wants to find it again.
    pub agent_id: Option<String>,
    /// The model the subagent ran on.
    pub model: Option<String>,
    /// Wall-clock time the subagent took. `u32` because the browser
    /// contract forbids 64-bit integers; 49 days of milliseconds is plenty.
    pub duration_ms: Option<u32>,
    /// Tokens the subagent consumed. `u32` for the same reason.
    pub tokens: Option<u32>,
    /// How many tools the subagent called.
    pub tool_uses: Option<u32>,
    /// What kinds of tools the subagent called.
    pub stats: Option<ToolStats>,
}

impl SubagentResult {
    /// Whether nothing at all was reported.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Take what `later` reports over what this holds, field by field - except
    /// the answer text, which the first report of keeps. A harness that
    /// reports its result twice (Claude Code: a rich `toolResponse`, then the
    /// bare `rawOutput`) says the important part first.
    pub fn merge(&mut self, later: Self) {
        if self.text.is_none() {
            self.text = later.text;
        }
        for (mine, theirs) in [
            (&mut self.error, later.error),
            (&mut self.agent_id, later.agent_id),
            (&mut self.model, later.model),
        ] {
            if theirs.is_some() {
                *mine = theirs;
            }
        }
        for (mine, theirs) in [
            (&mut self.duration_ms, later.duration_ms),
            (&mut self.tokens, later.tokens),
        ] {
            if theirs.is_some() {
                *mine = theirs;
            }
        }
        if later.tool_uses.is_some() {
            self.tool_uses = later.tool_uses;
        }
        if later.stats.is_some() {
            self.stats = later.stats;
        }
    }
}

/// A subagent's tool use, by kind. Claude Code's `toolStats`, in the fold's
/// vocabulary.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolStats {
    /// Files read.
    pub reads: u32,
    /// Searches run.
    pub searches: u32,
    /// Shell commands run.
    pub commands: u32,
    /// Files edited.
    pub edits: u32,
    /// Lines added across those edits.
    pub lines_added: u32,
    /// Lines removed across those edits.
    pub lines_removed: u32,
    /// Anything else.
    pub other: u32,
}
