//! Protocol log fixtures shared by this crate and downstream tests.

/// A hand-shaped complete turn with prose, tools, permission, and a clean stop.
pub const TURN: &str = include_str!("../../fixtures/turn.jsonl");

/// A hand-shaped Claude Code turn calling Macro tools over MCP - a read, a
/// user tool (`SendEmail`) the user later edits and sends, and a failed call -
/// with the MCP `CallToolResult` envelope around every output.
pub const MACRO_MCP: &str = include_str!("../../fixtures/macro_mcp.jsonl");

/// A sanitized real resumed session followed by fresh prompts.
pub const RESUMED_AND_CONTINUED: &str =
    include_str!("../../fixtures/real/resumed_and_continued.jsonl");

/// A sanitized real resumed session whose prompt is absent from this log.
pub const RESUMED_NO_PROMPT: &str = include_str!("../../fixtures/real/resumed_no_prompt.jsonl");

/// A long sanitized recording containing several resumes.
pub const LONG_MULTI_RESUME: &str = include_str!("../../fixtures/real/long_multi_resume.jsonl");

/// A sanitized real turn containing repeated plan updates.
pub const PLAN_TODO: &str = include_str!("../../fixtures/real/plan_todo.jsonl");

/// A sanitized real Claude Code turn delegating to a subagent: the `Agent`
/// call, the subagent's own `Bash` call attributed to it, and the rich
/// `toolResponse` with the subagent's answer and statistics.
pub const SUBAGENT_CLAUDE_CODE: &str =
    include_str!("../../fixtures/real/subagent_claude_code.jsonl");

/// A sanitized real OpenCode turn delegating to a subagent: the `task` call
/// whose completion names the child session and wraps the answer in
/// `<task_result>`, with nothing of the child streamed.
pub const SUBAGENT_OPENCODE: &str = include_str!("../../fixtures/real/subagent_opencode.jsonl");

/// A sanitized real Cursor (`cursor-acp`) turn delegating to a subagent: the
/// `task` call with `subagentType: { unspecified: {} }` and `model:
/// "default"`, whose completion carries the child's whole transcript in
/// `rawOutput.result.success.conversationSteps` - thoughts, prose, and two
/// `shellToolCall`s with their results - plus `agentId` and a `durationMs`
/// string. Nothing of the child is streamed as its own frames.
pub const SUBAGENT_CURSOR: &str = include_str!("../../fixtures/real/subagent_cursor.jsonl");

/// A sanitized real turn of Macro's in-process agent (`macro-inmem`)
/// delegating to a subagent: its native `Subagent` call, flagged
/// `_meta.macro.subagent: true`, with `{ "task" }` as input and the bare
/// `{ "result": "<answer>" }` response on completion. Nothing of the child is
/// streamed.
pub const SUBAGENT_MACRO_INMEM: &str =
    include_str!("../../fixtures/real/subagent_macro_inmem.jsonl");
