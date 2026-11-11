//! Artifacts published from files on disk.
//!
//! macrod adds its own stdio MCP server, `macrod mcp artifacts`, to every ACP
//! session that has Macro's MCP server. That server exposes `PublishArtifact`:
//! it reads files from the session's workspace itself, hashes them, and
//! uploads only what Macro does not have, so the agent never reads the bytes
//! into its context.
//!
//! It reaches Macro the way every other session tool does, through the agent
//! egress with the session token the harness already handed the agent
//! (`/artifacts` on the egress, which calls Macro as the person who prompted
//! the turn). No Macro API token exists on this machine.

use std::path::Path;

use agent_client_protocol::schema::v1::{EnvVariable, McpServer, McpServerStdio};
use serde_json::Value;

mod files;
mod mcp;
mod publish;

pub(crate) use mcp::serve;

#[cfg(test)]
mod test;

/// The name macrod's own server is advertised under.
pub(crate) const SERVER_NAME: &str = "macrod";

/// The tool's name, as agents see it under [`SERVER_NAME`].
pub(crate) const TOOL_NAME: &str = "PublishArtifact";

/// Macro's own MCP server in the session list, and the route the egress
/// serves it on (`agent_egress::model::MACRO_MCP_PATH`). Its URL is
/// `<egress>/mcp-macro`, which is how macrod learns the egress base.
const MACRO_SERVER_NAME: &str = "macro";
const MACRO_MCP_PATH: &str = "/mcp-macro";

/// The variables the server is launched with, read back by [`environment`].
const EGRESS_URL_VARIABLE: &str = "MACROD_EGRESS_URL";
const SESSION_TOKEN_VARIABLE: &str = "MACROD_SESSION_TOKEN";
const WEB_URL_VARIABLE: &str = "MACROD_WEB_URL";
const ROOT_VARIABLE: &str = "MACROD_ARTIFACT_ROOT";

pub(crate) mod environment {
    macro_env_var::env_vars! {
        /// Base URL of the agent egress.
        pub struct MacrodEgressUrl;
        /// The session token the egress resolves.
        pub struct MacrodSessionToken;
        /// Base URL of the Macro web app, for links to published artifacts.
        pub struct MacrodWebUrl;
    }
    macro_env_var::maybe_env_var! {
        /// The directory files are published from; the server's working
        /// directory when unset.
        pub struct MacrodArtifactRoot;
    }
}

/// What macrod needs to add its server to a session.
#[derive(Debug, Clone)]
pub(crate) struct LocalServer {
    /// The macrod executable the agent launches the server with.
    pub(crate) program: std::path::PathBuf,
    /// Base URL of the Macro web app.
    pub(crate) web_url: String,
}

impl LocalServer {
    /// This process's own executable, serving links under `web_url`.
    pub(crate) fn current(web_url: &str) -> std::io::Result<Self> {
        Ok(Self {
            program: std::env::current_exe()?,
            web_url: web_url.to_owned(),
        })
    }

    /// Add macrod's server to the `mcpServers` of `session/new`, `load` or
    /// `resume` params, rooted at the session's `cwd`. Only a session that
    /// has Macro's own server gets it, since that is where the egress and
    /// the session token come from. Says whether the server is there.
    pub(crate) fn add_to(&self, params: &mut Value) -> bool {
        let cwd = params.get("cwd").and_then(Value::as_str).map(str::to_owned);
        let Some(Value::Array(servers)) = params.get_mut("mcpServers") else {
            return false;
        };
        if servers
            .iter()
            .any(|server| server.get("name").and_then(Value::as_str) == Some(SERVER_NAME))
        {
            return true;
        }
        let Some((egress, token)) = servers.iter().find_map(macro_egress) else {
            return false;
        };

        let mut env = vec![
            EnvVariable::new(EGRESS_URL_VARIABLE, egress),
            EnvVariable::new(SESSION_TOKEN_VARIABLE, token),
            EnvVariable::new(WEB_URL_VARIABLE, self.web_url.clone()),
        ];
        if let Some(cwd) = cwd {
            env.push(EnvVariable::new(ROOT_VARIABLE, cwd));
        }
        let server = McpServer::Stdio(
            McpServerStdio::new(SERVER_NAME, self.program.clone())
                .args(vec!["mcp".to_owned(), "artifacts".to_owned()])
                .env(env),
        );
        match serde_json::to_value(server) {
            Ok(server) => {
                servers.push(server);
                true
            }
            Err(error) => {
                tracing::warn!(error = %error, "could not encode macrod's MCP server");
                false
            }
        }
    }
}

/// The egress base URL and session token, read off Macro's own server entry.
fn macro_egress(server: &Value) -> Option<(String, String)> {
    if server.get("name").and_then(Value::as_str) != Some(MACRO_SERVER_NAME) {
        return None;
    }
    let egress = server
        .get("url")
        .and_then(Value::as_str)?
        .strip_suffix(MACRO_MCP_PATH)?
        .to_owned();
    let token = server
        .get("headers")
        .and_then(Value::as_array)?
        .iter()
        .find(|header| {
            header
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case("authorization"))
        })?
        .get("value")
        .and_then(Value::as_str)?
        .strip_prefix("Bearer ")?
        .to_owned();
    Some((egress, token))
}

/// Root macrod's server at its own working directory instead of the
/// session's `cwd`: a native agent in a managed worktree works outside the
/// directory the session was opened in, and launches its MCP servers there.
#[cfg(unix)]
pub(crate) fn unroot(servers: &mut [Value]) {
    for server in servers {
        if server.get("name").and_then(Value::as_str) != Some(SERVER_NAME) {
            continue;
        }
        if let Some(Value::Array(env)) = server.get_mut("env") {
            env.retain(|entry| entry.get("name").and_then(Value::as_str) != Some(ROOT_VARIABLE));
        }
    }
}

/// Where a published artifact opens in Macro, and each of its scenes.
pub(crate) fn web_links(
    web_url: &str,
    artifact_id: &str,
    scenes: &[publish::Scene],
) -> (String, serde_json::Map<String, Value>) {
    let page = format!("{}/artifact/{artifact_id}", web_url.trim_end_matches('/'));
    let scenes = scenes
        .iter()
        .map(|scene| {
            (
                scene.id.clone(),
                Value::String(format!("{page}?scene={}", scene.id)),
            )
        })
        .collect();
    (page, scenes)
}

/// The workspace a server publishes from.
pub(crate) fn root() -> std::io::Result<std::path::PathBuf> {
    match environment::MacrodArtifactRoot::new() {
        Some(root) => Ok(Path::new(&*root).to_owned()),
        None => std::env::current_dir(),
    }
}
