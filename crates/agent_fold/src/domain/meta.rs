//! Harness-specific `_meta` extraction.
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
//! Everything that depends on a specific harness lives in this module, so
//! supporting a second one means adding a sibling reader rather than editing
//! the fold. Every function here treats a missing or misshapen key as "no
//! information" and returns `None`.

use agent_client_protocol::schema::v1::Meta;

/// The `_meta` keys written by the Claude Code harness.
pub mod claude_code {
    use super::Meta;

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
