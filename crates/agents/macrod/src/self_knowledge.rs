//! Tells each new session's agent what macrod is and what it can do from
//! here. The first `session/prompt` of a session the agent created gains a
//! leading text block describing this runtime; loaded and resumed sessions
//! already carry it from their first turn. General Macro guidance stays in
//! the Macro MCP server's `SelfKnowledge` tool.

use std::collections::HashMap;

use agent_session::domain::model::MACRO_PERMISSION_POLICY_META_KEY;
use serde_json::Value;

#[cfg(test)]
mod test;

/// What one session was opened with, as far as its agent should know.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionFacts {
    /// The directory the agent works in.
    pub(crate) workspace: String,
    /// Names of the MCP servers Macro forwarded to this session.
    pub(crate) mcp_servers: Vec<String>,
    /// Whether Macro approves the agent's tool permission requests itself.
    pub(crate) permission_bypass: bool,
}

/// Correlates `session/new` with its answer, then rewrites that session's
/// first prompt. The harness serves every session over one process, so
/// sessions are followed by request id until the agent names them.
#[derive(Debug, Default)]
pub(crate) struct SelfKnowledge {
    /// `session/new` requests awaiting their answer, by request id.
    opening: HashMap<String, SessionFacts>,
    /// Sessions created but not yet prompted, by ACP session id.
    unprompted: HashMap<String, SessionFacts>,
}

impl SelfKnowledge {
    /// Observe a message on its way to the agent, prefixing the runtime
    /// section to a new session's first prompt.
    pub(crate) fn outbound(&mut self, message: &mut Value) {
        match message.get("method").and_then(Value::as_str) {
            Some("session/new") => {
                let id = message
                    .get("id")
                    .filter(|id| !id.is_null())
                    .map(Value::to_string);
                if let (Some(id), Some(params)) = (id, message.get("params")) {
                    self.opening.insert(id, session_facts(params));
                }
            }
            Some("session/prompt") => {
                let Some(params) = message.get_mut("params") else {
                    return;
                };
                let Some(facts) = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .and_then(|session| self.unprompted.remove(session))
                else {
                    return;
                };
                if let Some(Value::Array(prompt)) = params.get_mut("prompt") {
                    prompt.insert(
                        0,
                        serde_json::json!({"type": "text", "text": render(&facts)}),
                    );
                }
            }
            _ => {}
        }
    }

    /// Observe a message from the agent, learning which session a
    /// `session/new` answer created.
    pub(crate) fn inbound(&mut self, message: &Value) {
        if message.get("method").is_some() {
            return;
        }
        let Some(id) = message
            .get("id")
            .filter(|id| !id.is_null())
            .map(Value::to_string)
        else {
            return;
        };
        let Some(facts) = self.opening.remove(&id) else {
            return;
        };
        if let Some(session) = message.pointer("/result/sessionId").and_then(Value::as_str) {
            self.unprompted.insert(session.to_owned(), facts);
        }
    }
}

fn session_facts(params: &Value) -> SessionFacts {
    SessionFacts {
        workspace: params
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        mcp_servers: params
            .get("mcpServers")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|server| server.get("name").and_then(Value::as_str))
            .map(str::to_owned)
            .collect(),
        permission_bypass: params
            .pointer("/_meta")
            .and_then(|meta| meta.get(MACRO_PERMISSION_POLICY_META_KEY))
            .and_then(Value::as_str)
            == Some("autoAccept"),
    }
}

/// The runtime section, listing only what this session actually has.
pub(crate) fn render(facts: &SessionFacts) -> String {
    let mut lines = vec![
        "<macrod-runtime>".to_owned(),
        format!(
            "You are running through macrod {}, the Macro agent daemon on the operator's own {} machine. \
             Macro users reach you from Macro (channels, documents, agent sessions); each prompt arrives \
             through macrod, and your replies stream back to Macro.",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
        ),
    ];
    if !facts.workspace.is_empty() {
        lines.push(format!(
            "- Workspace: you work in `{}` on the operator's machine. Changes there are real.",
            facts.workspace
        ));
    }
    if !facts.mcp_servers.is_empty() {
        lines.push(format!(
            "- MCP servers forwarded from Macro: {}. Use them to read and act in the Macro workspace; \
             for questions about Macro itself, call its SelfKnowledge tool.",
            facts.mcp_servers.join(", ")
        ));
    }
    if facts.permission_bypass {
        lines.push(
            "- Permission bypass: Macro approves your tool permission requests automatically; \
             no one is asked before you run commands or edit files."
                .to_owned(),
        );
    }
    lines.push("</macrod-runtime>".to_owned());
    lines.join("\n")
}
