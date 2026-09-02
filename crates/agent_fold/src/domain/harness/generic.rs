//! The harness-neutral readings every [`HarnessReader`] starts from.
//!
//! These read conventions that are not any one harness's: the ACP title as
//! the tool's name, and the `_meta.terminal_output` / `_meta.terminal_exit`
//! keys, which are an ACP *client* extension (Zed's - a client advertises
//! `clientCapabilities._meta.terminal_output`) that any agent serving that
//! client writes, whichever harness it is.

use agent_client_protocol::schema::v1::Meta;

use super::HarnessReader;

/// A harness this fold knows nothing specific about.
pub struct Generic;

impl HarnessReader for Generic {}

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
