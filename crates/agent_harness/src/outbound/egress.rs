//! Handing a sandbox its one secret, and telling opencode where to spend it.
//!
//! Two adapter concerns the domain has no business with: minting a token, and
//! listing the owner's connected MCP servers, which needs their rows.
//!
//! Both the minting and the hashing are `agent_egress`'s, not a second
//! implementation of either. The two ends of this token are written in
//! different crates and read months apart, and a hash computed differently at
//! each end reads at runtime as "every request from every sandbox is
//! unauthenticated".

use agent_egress::domain::model::{McpServerSlug, RepoSlug, SessionToken};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use std::sync::Arc;
use url::Url;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{ProvisionedEgress, SandboxEgress};
use crate::domain::ports::SandboxEgressProvisioner;
use agent_session::domain::model::AgentSessionId;

#[cfg(test)]
mod test;

/// The only host a configured repository URL may name. Validating the
/// deployment's own configuration, not a request: a URL pointing somewhere else
/// would mint a session token for a repository the proxy cannot reach.
const GITHUB_HOST: &str = "github.com";

/// Mints session tokens and generates the sandbox's opencode config.
pub struct EgressProvisioner<Servers> {
    servers: Arc<Servers>,
    base_url: String,
}

impl<Servers> EgressProvisioner<Servers>
where
    Servers: McpServerStore,
{
    /// Build the provisioner over the MCP server store and the egress
    /// proxy's public address.
    pub fn new(servers: Arc<Servers>, base_url: impl Into<String>) -> Self {
        Self {
            servers,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        }
    }

    /// The slugs of the owner's enabled MCP servers.
    ///
    /// A server the owner turned off is left out here as well as refused by
    /// the proxy: an agent that can see a server in its config will try it,
    /// and a tool call that always fails is worse than a tool that is absent.
    async fn slugs(&self, owner: &MacroUserIdStr<'static>) -> Result<Vec<McpServerSlug>> {
        let records = self.servers.list(owner).await.map_err(|error| {
            HarnessError::Egress(rootcause::report!(
                "could not list connected MCP servers: {error:?}"
            ))
        })?;

        Ok(records
            .into_iter()
            .filter(|record| record.enabled)
            .filter_map(|record| McpServerSlug::from_server_name(&record.server_name))
            .collect())
    }
}

impl<Servers> SandboxEgressProvisioner for EgressProvisioner<Servers>
where
    Servers: McpServerStore,
{
    #[tracing::instrument(err, skip(self), fields(%session, %owner))]
    async fn provision(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        repo_url: &str,
    ) -> Result<ProvisionedEgress> {
        // Validated even though nothing here uses it: it is the deployment's
        // repository URL, and a session whose git traffic could never resolve
        // should fail at provisioning rather than at the agent's first clone.
        repo_slug(repo_url)?;

        let token = SessionToken::mint();
        let config = opencode_config(&self.base_url, token.as_str(), &self.slugs(owner).await?)
            .map_err(|error| {
                HarnessError::Egress(rootcause::report!(
                    "could not render opencode config: {error}"
                ))
            })?;

        Ok(ProvisionedEgress {
            session_token_hash: token.hash(),
            sandbox: SandboxEgress {
                base_url: self.base_url.clone(),
                session_token: token.as_str().to_owned(),
                opencode_config: config,
            },
        })
    }
}

/// The repository a configured GitHub URL names.
///
/// Deliberately narrow: it must be `https://github.com/<owner>/<name>` and
/// nothing else. This reads the deployment's own configuration, so a URL that
/// is nearly right - a different host, an extra path segment - is a mistake
/// worth failing on rather than guessing at, and the answer decides which
/// repository a session's credential will be minted for.
fn repo_slug(repo_url: &str) -> Result<RepoSlug> {
    let unusable = || {
        HarnessError::Egress(rootcause::report!(
            "configured repository url does not name a github repository"
        ))
    };

    let url = Url::parse(repo_url).map_err(|_| unusable())?;
    if url.host_str() != Some(GITHUB_HOST) {
        return Err(unusable());
    }

    let mut segments = url.path_segments().ok_or_else(unusable)?;
    let owner = segments.next().ok_or_else(unusable)?;
    let name = segments.next().ok_or_else(unusable)?;
    // Anything after the repository name is not part of it. A trailing empty
    // segment is just a trailing slash.
    if segments.any(|segment| !segment.is_empty()) {
        return Err(unusable());
    }

    RepoSlug::parse(owner, name.trim_end_matches(".git")).ok_or_else(unusable)
}

/// The opencode config a sandbox starts with.
///
/// opencode merges `OPENCODE_CONFIG_CONTENT` last, over the baked global config
/// and over whatever `opencode.json` the repository itself carries, so this is
/// the final word on which MCP servers exist and how they are reached.
///
/// Every server is `"type": "remote"` pointed at the egress proxy, never at the
/// server itself, and carries the session token - the sandbox holds no upstream
/// credential to point anywhere with.
///
/// `"oauth": false` is load-bearing. Without it opencode notices the 401 an
/// unauthorized server returns and starts its own interactive OAuth flow, which
/// wants a loopback redirect and a browser; in a headless sandbox that can
/// never complete, so the agent hangs instead of getting an error it can read.
fn opencode_config(
    base_url: &str,
    session_token: &str,
    slugs: &[McpServerSlug],
) -> serde_json::Result<String> {
    let servers = slugs
        .iter()
        .map(|slug| {
            (
                slug.to_string(),
                serde_json::json!({
                    "type": "remote",
                    "url": format!("{base_url}/mcp/{slug}"),
                    "headers": { "Authorization": format!("Bearer {session_token}") },
                    "oauth": false,
                }),
            )
        })
        .collect::<serde_json::Map<_, _>>();

    serde_json::to_string(&serde_json::json!({ "mcp": servers }))
}
