//! What macrod does differently on a Macro computer: every Claude Code
//! session starts with Macro's Anthropic gateway in its environment, derived
//! from the session's `macro_internal` MCP server, and first-party traffic
//! goes through the computer's egress route. The env reaches Claude Code
//! through the ACP adapter's `_meta.claudeCode.options.env`.
//!
//! Sign-in is not macrod's: harnessd on the computer owns it, and the image's
//! `claude` wrapper swaps the gateway for the computer's own Claude
//! credential when there is one.

use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::config::MacroApi;

#[cfg(test)]
mod test;

/// `agent_harness::domain::model::INTERNAL_MCP_NAME`, which macrod cannot
/// depend on.
const INTERNAL_MCP_NAME: &str = "macro_internal";
/// The `macro_internal` MCP server's path, and the gateway's in its place.
const INTERNAL_MCP_PATH: &str = "/mcp/internal";
const ANTHROPIC_GATEWAY_PATH: &str = "/anthropic";
/// ACP methods that start a Claude Code query.
const SESSION_METHODS: &[&str] = &["session/new", "session/load", "session/resume"];

/// Written last by enrollment; only machines bearing it are Macro computers.
pub const ENROLLED_MARKER: &str = "/var/lib/macrod/enrolled";

/// Whether this machine is an enrolled Macro computer.
pub fn is_macro_computer() -> bool {
    cfg!(unix) && std::path::Path::new(ENROLLED_MARKER).exists()
}

/// A Macro computer's runtime-side settings, shared by every bridge.
pub struct Computer {
    workspace: PathBuf,
    egress_url: Option<String>,
}

impl Computer {
    /// The enrolled computer's settings.
    pub fn new(macro_api: &MacroApi, workspace: &std::path::Path) -> Self {
        Self {
            workspace: workspace.to_owned(),
            egress_url: macro_api.egress_url.clone(),
        }
    }

    /// Point a Claude Code session at the gateway through the egress route.
    /// Leaves anything but a session-starting request alone.
    pub fn prepare_session(&self, frame: &mut Value) -> rootcause::Result<()> {
        prepare_session(frame, &self.workspace, self.egress_url.as_deref())
    }
}

/// Merge the session env into a session-starting request's
/// `params._meta.claudeCode.options.env`.
fn prepare_session(
    frame: &mut Value,
    workspace: &std::path::Path,
    egress_url: Option<&str>,
) -> rootcause::Result<()> {
    let is_session_start = frame
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| SESSION_METHODS.contains(&method));
    if !is_session_start {
        return Ok(());
    }
    let params = frame
        .get_mut("params")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| rootcause::report!("a session start needs params"))?;
    if params.get("cwd").and_then(Value::as_str) == Some("/workspace") {
        params.insert(
            "cwd".to_owned(),
            Value::from(workspace.to_string_lossy().as_ref()),
        );
    }
    if let Some(egress_url) = egress_url {
        route_egress(params, egress_url);
    }
    let env = gateway_env(params.get("mcpServers")).ok_or_else(|| {
        rootcause::report!("a computer session needs the macro_internal gateway credentials")
    })?;
    let mut target = params;
    for key in ["_meta", "claudeCode", "options", "env"] {
        let next = object_at(target, key).ok_or_else(|| {
            rootcause::report!("could not prepare the Claude session environment")
        })?;
        target = next;
    }
    for key in [
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    ] {
        target.remove(key);
    }
    target.extend(env);
    Ok(())
}

/// The object under `key`, replacing anything that is not one.
fn object_at<'object>(
    object: &'object mut Map<String, Value>,
    key: &str,
) -> Option<&'object mut Map<String, Value>> {
    let entry = object
        .entry(key)
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    entry.as_object_mut()
}

/// The gateway variables, from the session's `macro_internal` MCP server:
/// its URL with `/mcp/internal` replaced by `/anthropic`, and its bearer.
fn gateway_env(mcp_servers: Option<&Value>) -> Option<Map<String, Value>> {
    let server = mcp_servers?
        .as_array()?
        .iter()
        .find(|server| server.get("name").and_then(Value::as_str) == Some(INTERNAL_MCP_NAME))?;
    let url = server.get("url")?.as_str()?;
    let base = url.strip_suffix(INTERNAL_MCP_PATH)?;
    let bearer = server
        .get("headers")?
        .as_array()?
        .iter()
        .find(|header| {
            header
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case("authorization"))
        })?
        .get("value")?
        .as_str()?
        .strip_prefix("Bearer ")?;
    Some(Map::from_iter([
        (
            "ANTHROPIC_BASE_URL".to_owned(),
            Value::from(format!("{base}{ANTHROPIC_GATEWAY_PATH}")),
        ),
        ("ANTHROPIC_AUTH_TOKEN".to_owned(), Value::from(bearer)),
        (
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_owned(),
            Value::from("1"),
        ),
    ]))
}

/// Keep first-party MCP and inference requests on the enrolled computer route.
fn route_egress(params: &mut Map<String, Value>, egress_url: &str) {
    let Some(servers) = params.get_mut("mcpServers").and_then(Value::as_array_mut) else {
        return;
    };
    let base = servers
        .iter()
        .find(|server| server.get("name").and_then(Value::as_str) == Some(INTERNAL_MCP_NAME))
        .and_then(|server| server.get("url"))
        .and_then(Value::as_str)
        .and_then(|url| url.strip_suffix(INTERNAL_MCP_PATH))
        .map(str::to_owned);
    let Some(base) = base else {
        return;
    };
    for server in servers {
        let Some(url) = server.get("url").and_then(Value::as_str) else {
            continue;
        };
        if let Some(path) = url.strip_prefix(&base).filter(|path| path.starts_with('/')) {
            let routed = format!("{}{path}", egress_url.trim_end_matches('/'));
            server["url"] = Value::from(routed);
        }
    }
}
