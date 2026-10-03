//! Native MCP configuration and OAuth commands for supported harnesses.
//!
//! CLI references:
//! - https://code.claude.com/docs/en/mcp
//! - https://developers.openai.com/codex/mcp/
//! - https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
//! - https://docs.openclaw.ai/cli/mcp/registry
//! - https://opencode.ai/docs/mcp-servers/

use super::{AgentKind, DetectedAgent};
use crate::setup::{SetupCommand, SetupPlan};

impl DetectedAgent {
    /// Build a setup plan using the same CLI and environment as the ACP adapter.
    /// Custom ACP commands have no standardized MCP configuration CLI.
    pub(crate) fn mcp_setup(&self, url: &str) -> Option<SetupPlan> {
        let program = match self.kind {
            AgentKind::Hermes => "hermes",
            AgentKind::ClaudeCode => self
                .launch
                .env
                .get("CLAUDE_CODE_EXECUTABLE")
                .map(String::as_str)
                .unwrap_or("claude"),
            AgentKind::Codex => self
                .launch
                .env
                .get("CODEX_PATH")
                .map(String::as_str)
                .unwrap_or("codex"),
            AgentKind::OpenClaw => "openclaw",
            AgentKind::OpenCode => "opencode",
            AgentKind::Custom => return None,
        };
        let command = |args: &[&str], success_text| SetupCommand {
            program: program.to_owned(),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
            env: self.launch.env.clone(),
            success_text,
        };
        let config = serde_json::json!({"url": url, "auth": "oauth"}).to_string();
        let claw_config = serde_json::json!({
            "url": url, "transport": "streamable-http", "auth": "oauth"
        })
        .to_string();
        let (add, login) = match self.kind {
            AgentKind::Hermes => (
                command(
                    &["config", "set", "mcp_servers.macro", &config],
                    Some("Set mcp_servers.macro ="),
                ),
                command(&["mcp", "login", "macro"], Some("Authenticated")),
            ),
            AgentKind::ClaudeCode => (
                command(
                    &[
                        "mcp",
                        "add",
                        "--scope",
                        "user",
                        "--transport",
                        "http",
                        "macro",
                        url,
                    ],
                    None,
                ),
                command(&["mcp", "login", "macro"], None),
            ),
            AgentKind::Codex => (
                command(&["mcp", "add", "macro", "--url", url], None),
                command(&["mcp", "login", "macro"], None),
            ),
            AgentKind::OpenClaw => (
                command(&["mcp", "set", "macro", &claw_config], None),
                command(&["mcp", "login", "macro"], None),
            ),
            AgentKind::OpenCode => (
                command(&["mcp", "add", "macro", "--url", url], None),
                command(
                    &["mcp", "auth", "macro"],
                    Some("Authentication successful!"),
                ),
            ),
            AgentKind::Custom => unreachable!(),
        };
        Some(SetupPlan {
            commands: vec![add, login],
            existing_server: (self.kind == AgentKind::ClaudeCode)
                .then(|| command(&["mcp", "get", "macro"], None)),
            url: url.to_owned(),
        })
    }
}

#[cfg(test)]
mod test;
