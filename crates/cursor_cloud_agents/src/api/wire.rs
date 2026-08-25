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

/// An explicit model choice: an id plus the params that pin its variant.
///
/// Both halves are required in practice. Cursor answers a bare id with
/// `validation_error: Model 'grok-4.5' does not match a known variant`, so
/// `params` is omitted only when a caller genuinely has none to send.
#[derive(Debug, Serialize)]
pub struct ModelSelection {
    /// Model id, e.g. `composer-2.5`.
    pub id: String,
    /// The variant's parameters. Omitted when empty rather than sent as `[]`,
    /// which Cursor reads as "a variant with no params" and may not have.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<ModelParamSelection>,
}

/// One `{id, value}` parameter of a model variant.
#[derive(Debug, Serialize)]
pub struct ModelParamSelection {
    /// The parameter's id, e.g. `reasoning`.
    pub id: String,
    /// Its value, always a string on this wire — Cursor enumerates booleans as
    /// `"true"`/`"false"`.
    pub value: String,
}

impl From<&crate::domain::model::ModelChoice> for ModelSelection {
    fn from(choice: &crate::domain::model::ModelChoice) -> Self {
        Self {
            id: choice.id.clone(),
            params: choice
                .params
                .iter()
                .map(|param| ModelParamSelection {
                    id: param.id.clone(),
                    value: param.value.clone(),
                })
                .collect(),
        }
    }
}

/// `GET /v1/models` response.
#[derive(Debug, Deserialize)]
pub struct ListModelsResponse {
    /// The offered models. Cursor names this `items`.
    #[serde(default)]
    pub items: Vec<ModelListing>,
}

/// One model as `GET /v1/models` describes it.
///
/// `parameters` — the per-parameter list of permitted values — is deliberately
/// not modelled: `variants` already enumerates every combination Cursor will
/// accept, which is the only question this crate asks. Reading both would mean
/// deciding what to do when they disagree.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListing {
    /// The id to send.
    pub id: String,
    /// The human-readable name.
    pub display_name: Option<String>,
    /// The accepted id+params combinations.
    #[serde(default)]
    pub variants: Vec<VariantListing>,
}

/// One accepted parameter combination for a model.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantListing {
    /// The parameters this variant fixes.
    #[serde(default)]
    pub params: Vec<ParamListing>,
    /// Whether Cursor marks this the default.
    #[serde(default)]
    pub is_default: bool,
}

/// One `{id, value}` pair inside a variant.
#[derive(Debug, Deserialize)]
pub struct ParamListing {
    /// The parameter's id.
    pub id: String,
    /// Its value.
    pub value: String,
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
    /// The model for this run.
    ///
    /// Undocumented on this endpoint — Cursor's reference lists only `prompt`,
    /// `mode` and `mcpServers`, and says follow-up runs inherit the agent's
    /// model — but the endpoint validates it and honours it. Its schema is
    /// strict (an unknown key is a `validation_error` naming the key), which is
    /// how the field was confirmed to exist rather than be ignored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelSelection>,
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
