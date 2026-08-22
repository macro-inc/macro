//! Request/response DTOs for the Cloud Agents endpoints this crate uses.
//!
//! Shapes follow the Cloud Agents API reference; only the fields this crate
//! reads are modelled, and unknown response fields are ignored so Cursor can
//! grow its API without breaking us.

#[cfg(test)]
mod test;

use crate::domain::model::McpServer;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The prompt payload shared by agent and run creation.
#[derive(Debug, Serialize)]
pub struct PromptBody {
    /// The prompt text.
    pub text: String,
}

/// One repository for a new agent to clone.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSelection {
    /// HTTPS repository url.
    pub url: String,
    /// Ref to start from.
    pub starting_ref: String,
}

/// An explicit model choice.
#[derive(Debug, Serialize)]
pub struct ModelSelection {
    /// Model id, e.g. `composer-2.5`.
    pub id: String,
}

/// One MCP server for a new agent to connect to.
///
/// Only remote transports: an agent's MCP configuration is fixed at creation
/// and runs inside Cursor's sandbox, so a url is reachable from there while a
/// local executable path is not — see [`McpServer`].
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSelection {
    /// The client's name for the server.
    pub name: String,
    /// Transport discriminator: `http` or `sse`.
    #[serde(rename = "type")]
    pub transport: &'static str,
    /// The server's url.
    pub url: String,
    /// Headers to send with each request. Omitted entirely when there are
    /// none, rather than sent as an empty object.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
}

impl From<&McpServer> for McpServerSelection {
    fn from(server: &McpServer) -> Self {
        Self {
            name: server.name.clone(),
            transport: server.transport.as_str(),
            url: server.url.clone(),
            // Cursor takes headers as an object; ACP hands them over as a
            // list of pairs. A repeated name is the client contradicting
            // itself, and last-wins is the only reading a map allows.
            headers: server
                .headers
                .iter()
                .map(|header| (header.name.clone(), header.value.clone()))
                .collect(),
        }
    }
}

/// `POST /v1/agents`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    /// The initial prompt.
    pub prompt: PromptBody,
    /// Repositories to clone; empty means a repo-less agent.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub repos: Vec<RepoSelection>,
    /// Model override, when configured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelSelection>,
    /// MCP servers the ACP client configured. Omitted when empty so Cursor's
    /// own MCP configuration is left alone rather than overridden with an
    /// empty list.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<McpServerSelection>,
}

/// `POST /v1/agents` response: the agent and its first run together.
#[derive(Debug, Deserialize)]
pub struct CreateAgentResponse {
    /// The created agent.
    pub agent: AgentSummary,
    /// Its initial run.
    pub run: RunSummary,
}

/// The slice of an agent record this crate reads.
#[derive(Debug, Deserialize)]
pub struct AgentSummary {
    /// Agent id (`bc-…`).
    pub id: String,
    /// Display name Cursor derived from the prompt.
    #[serde(default)]
    pub name: String,
    /// The agent's page on cursor.com — logged so a session can be opened in
    /// the browser without reconstructing the link.
    #[serde(default)]
    pub url: String,
}

/// `GET /v1/agents/{id}/runs/{run}` — the slice the fallback poll reads.
#[derive(Debug, Deserialize)]
pub struct RunDetail {
    /// Where the run is in its lifecycle.
    pub status: crate::domain::model::RunStatus,
    /// The final assistant reply, present once the run is terminal.
    #[serde(default)]
    pub result: Option<String>,
}

/// `GET /v1/agents/{id}/runs` response.
#[derive(Debug, Deserialize)]
pub struct ListRunsResponse {
    /// The agent's runs, newest first.
    pub items: Vec<RunListItem>,
}

/// One run in a `GET /v1/agents/{id}/runs` page.
#[derive(Debug, Deserialize)]
pub struct RunListItem {
    /// Run id (`run-…`).
    pub id: String,
    /// Where the run is in its lifecycle.
    pub status: crate::domain::model::RunStatus,
}

/// `GET /v1/agents` response.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentsResponse {
    /// The page of agents, newest first.
    pub items: Vec<AgentSummary>,
    /// Cursor for the next page. Absent — not null — when this page is the
    /// last, so an `Option` with a default reads both.
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// `POST /v1/agents/{id}/archive` response.
#[derive(Debug, Deserialize)]
pub struct ArchiveAgentResponse {
    /// The archived agent's id.
    pub id: String,
}

/// `GET /v1/me`: who this API key is.
///
/// User-scoped keys carry the owner's identity; service-account keys carry
/// only the key's own name, which is why everything but `api_key_name` is
/// optional.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    /// Display name of the API key.
    pub api_key_name: String,
    /// Email of the key's owner; absent on service-account keys.
    #[serde(default)]
    pub user_email: Option<String>,
}

/// The slice of a run record this crate reads.
#[derive(Debug, Deserialize)]
pub struct RunSummary {
    /// Run id (`run-…`).
    pub id: String,
}

/// `POST /v1/agents/{id}/runs`.
#[derive(Debug, Serialize)]
pub struct CreateRunRequest {
    /// The follow-up prompt.
    pub prompt: PromptBody,
}

/// `POST /v1/agents/{id}/runs` response.
///
/// Observed both as a bare run object and as `{"run": {…}}`; both shapes are
/// accepted rather than betting on one.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum CreateRunResponse {
    /// The run nested under a `run` key.
    Wrapped {
        /// The created run.
        run: RunSummary,
    },
    /// The run as the whole body.
    Bare(RunSummary),
}

impl CreateRunResponse {
    /// The created run's id, whichever shape arrived.
    #[must_use]
    pub fn into_run_id(self) -> String {
        match self {
            Self::Wrapped { run } | Self::Bare(run) => run.id,
        }
    }
}
