//! Which known product a registered MCP client is, for the mark its posts wear.
//!
//! Registration is open, so a client's name proves nothing: anyone can register
//! as "Claude". Its redirect URIs are the evidence. A code is delivered only to
//! a registered redirect URI, so a client whose every URI is on Claude's host is
//! Claude's service. A native client can only prove a loopback listener, which
//! is on the user's own machine and so no more than its name already claims.
//! A name is therefore taken only when every redirect URI is somewhere that
//! product would send its users: a web product's own host, or loopback for a
//! native one. Anything else is `None`, the letter avatar.

#[cfg(test)]
mod test;

use mcp_client_label::McpClientKind;

use super::redirect_uri::LOOPBACK_HOSTS;

/// Where a product's redirect URIs may point.
#[derive(Clone, Copy)]
enum Destination {
    /// An `http` listener on the user's machine.
    Loopback,
    /// An `https` URI on exactly this host.
    Host(&'static str),
}

/// The known product a registration is, or `None` for the letter avatar.
pub fn classify(client_name: &str, redirect_uris: &[String]) -> Option<McpClientKind> {
    let kind = kind_named(client_name)?;

    let allowed = destinations(kind);
    let consistent = !redirect_uris.is_empty()
        && redirect_uris
            .iter()
            .all(|uri| allowed.iter().any(|destination| points_to(uri, *destination)));

    consistent.then_some(kind)
}

/// The product a registration name claims. Claude Code appends the user's own
/// name for the server in parentheses ("Claude Code (macro)"), so a trailing
/// parenthetical is ignored.
fn kind_named(client_name: &str) -> Option<McpClientKind> {
    let name = client_name.trim();
    let name = match name.rfind('(') {
        Some(open) if name.ends_with(')') => &name[..open],
        _ => name,
    };
    let name = name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();

    match name.as_str() {
        "claude" => Some(McpClientKind::Claude),
        "claude code" => Some(McpClientKind::ClaudeCode),
        "chatgpt" => Some(McpClientKind::ChatGpt),
        "cursor" => Some(McpClientKind::Cursor),
        "codex" => Some(McpClientKind::Codex),
        "opencode" => Some(McpClientKind::OpenCode),
        _ => None,
    }
}

/// Where a product's registrations send codes. Cursor registers its loopback
/// listener and its site together.
fn destinations(kind: McpClientKind) -> &'static [Destination] {
    match kind {
        McpClientKind::Claude => &[Destination::Host("claude.ai")],
        McpClientKind::ChatGpt => &[
            Destination::Host("chatgpt.com"),
            Destination::Host("chat.openai.com"),
        ],
        McpClientKind::Cursor => &[
            Destination::Loopback,
            Destination::Host("cursor.com"),
            Destination::Host("www.cursor.com"),
        ],
        McpClientKind::ClaudeCode | McpClientKind::Codex | McpClientKind::OpenCode => {
            &[Destination::Loopback]
        }
    }
}

fn points_to(uri: &str, destination: Destination) -> bool {
    let Ok(parsed) = url::Url::parse(uri) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };

    match destination {
        Destination::Loopback => parsed.scheme() == "http" && LOOPBACK_HOSTS.contains(&host),
        Destination::Host(expected) => parsed.scheme() == "https" && host == expected,
    }
}
