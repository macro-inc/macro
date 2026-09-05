//! Provider-safe tool names for MCP tools.
//!
//! Every tool is exposed as `mcp__<server>__<tool>` so names stay unique
//! across servers and can be routed back without a lookup table.

#[cfg(test)]
mod test;

const MANGLED_PREFIX: &str = "mcp__";
const MANGLED_SEPARATOR: &str = "__";
/// Model providers reject tool names that do not match
/// `^[a-zA-Z0-9_-]{1,128}$`, and they validate the whole tool array: a single
/// malformed name fails every request in the conversation, not just calls to
/// that tool.
const MAX_MANGLED_LEN: usize = 128;
/// Substituted when the server segment sanitizes to nothing, so a mangled
/// name can never contain an empty segment.
const EMPTY_SERVER_SEGMENT: &str = "server";
/// Substituted when the tool segment sanitizes to nothing.
const EMPTY_TOOL_SEGMENT: &str = "tool";
/// Floor for truncating the server segment, so a very long tool name cannot
/// squeeze the server segment down to nothing. Must exceed both placeholders.
const MIN_TRUNCATED_SEGMENT: usize = 8;

/// The characters model providers accept in a tool name.
fn is_allowed(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// Replaces every run of disallowed characters with a single `_` and trims
/// leading and trailing underscores.
///
/// `collapse_underscores` additionally collapses runs of underscores into one.
/// The server segment needs that: [`MangledName::parse`] splits on the first
/// `__`, so a server segment containing `__` would make the split report the
/// wrong server name.
fn sanitize_segment(raw: &str, collapse_underscores: bool) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_disallowed_run = false;
    for c in raw.chars() {
        let next = if is_allowed(c) {
            in_disallowed_run = false;
            c
        } else if in_disallowed_run {
            continue;
        } else {
            in_disallowed_run = true;
            '_'
        };
        if collapse_underscores && next == '_' && out.ends_with('_') {
            continue;
        }
        out.push(next);
    }
    out.trim_matches('_').to_owned()
}

/// Shortens an already sanitized (so ASCII) segment to at most `max` bytes,
/// dropping any underscore left dangling at the cut and falling back to
/// `placeholder` if nothing survives.
fn fit_segment(segment: &mut String, max: usize, placeholder: &str) {
    if segment.len() <= max {
        return;
    }
    segment.truncate(max);
    while segment.ends_with('_') {
        segment.pop();
    }
    if segment.is_empty() {
        segment.push_str(placeholder);
    }
}

/// A mangled tool name plus whether sanitizing had to change it.
pub(crate) struct Mangled {
    /// The sanitized name, always matching `^[a-zA-Z0-9_-]{1,128}$`.
    pub(crate) name: MangledName,
    /// Set when the sanitized name differs from the raw `server__tool` join,
    /// i.e. the raw names would have been rejected by the provider.
    pub(crate) sanitized: bool,
}

/// A mangled tool name in the format `mcp__<server>__<tool>`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct MangledName(pub(crate) String);

impl Mangled {
    /// Builds `mcp__<server>__<tool>`, sanitizing both segments so the result
    /// always matches `^[a-zA-Z0-9_-]{1,128}$`.
    ///
    /// Server names are human-readable display names (`Google Sheets`), so
    /// they routinely contain characters providers reject. Sanitizing here
    /// rather than where the name is written also covers names already
    /// persisted, and keeps every future source of the name covered.
    ///
    /// Truncation is safe for dispatch: the unmangled tool name is kept on
    /// the registered tool and is what gets sent to the peer.
    pub(crate) fn new(server_name: &str, tool_name: &str) -> Self {
        let mut server = sanitize_segment(server_name, true);
        let mut tool = sanitize_segment(tool_name, false);

        if server.is_empty() {
            server = EMPTY_SERVER_SEGMENT.to_owned();
        }
        if tool.is_empty() {
            tool = EMPTY_TOOL_SEGMENT.to_owned();
        }

        let budget = MAX_MANGLED_LEN - MANGLED_PREFIX.len() - MANGLED_SEPARATOR.len();
        if server.len() + tool.len() > budget {
            let server_max = budget.saturating_sub(tool.len()).max(MIN_TRUNCATED_SEGMENT);
            fit_segment(&mut server, server_max, EMPTY_SERVER_SEGMENT);
        }
        if server.len() + tool.len() > budget {
            fit_segment(&mut tool, budget - server.len(), EMPTY_TOOL_SEGMENT);
        }

        let sanitized = server != server_name || tool != tool_name;
        Self {
            name: MangledName(format!("{MANGLED_PREFIX}{server}{MANGLED_SEPARATOR}{tool}")),
            sanitized,
        }
    }
}

impl MangledName {
    pub(crate) fn parse(s: &str) -> Option<(&str, &str)> {
        s.strip_prefix(MANGLED_PREFIX)?
            .split_once(MANGLED_SEPARATOR)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for MangledName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
