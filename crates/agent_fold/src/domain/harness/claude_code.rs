//! The `_meta` keys written by the Claude Code harness.

use agent_client_protocol::schema::v1::Meta;

/// The harness's own name for the tool behind a `tool_call`.
///
/// Reads `_meta.claudeCode.toolName`.
#[must_use]
pub fn tool_name(meta: Option<&Meta>) -> Option<String> {
    meta?
        .get("claudeCode")?
        .get("toolName")?
        .as_str()
        .map(ToOwned::to_owned)
}

/// A chunk of terminal output carried on a `tool_call_update`.
///
/// Reads `_meta.terminal_output.data`. Each update carries the output
/// accumulated so far rather than only the new bytes, so callers should
/// replace rather than append.
#[must_use]
pub fn terminal_output(meta: Option<&Meta>) -> Option<String> {
    meta?
        .get("terminal_output")?
        .get("data")?
        .as_str()
        .map(ToOwned::to_owned)
}

/// The exit code reported when a terminal-backed tool call finished.
///
/// Reads `_meta.terminal_exit.exit_code`.
#[must_use]
pub fn terminal_exit_code(meta: Option<&Meta>) -> Option<i32> {
    let code = meta?.get("terminal_exit")?.get("exit_code")?.as_i64()?;
    i32::try_from(code).ok()
}
