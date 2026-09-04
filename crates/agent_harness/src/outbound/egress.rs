//! Handing a sandbox its one secret, and telling opencode where to spend it.
//!
//! Two adapter concerns the domain has no business with: minting a token, and
//! listing the owner's connected apps, which needs their rows.
//!
//! Both the minting and the hashing are `agent_egress`'s, not a second
//! implementation of either. The two ends of this token are written in
//! different crates and read months apart, and a hash computed differently at
//! each end reads at runtime as "every request from every sandbox is
//! unauthenticated".

use agent_egress::domain::model::{
    AdvertisedMcp, CustomMcpId, McpServerSlug, RepoSlug, SessionToken,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use pipedream_mcp::domain::ports::ConnectionStore;
use std::collections::HashSet;
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

/// Mints session tokens and gathers the MCP servers a sandbox may dial.
pub struct EgressProvisioner<Connections, Native> {
    connections: Arc<Connections>,
    native: Option<Arc<Native>>,
    base_url: String,
}

impl<Connections, Native> EgressProvisioner<Connections, Native>
where
    Connections: ConnectionStore,
    Native: McpServerStore,
{
    /// Build the provisioner over the Pipedream connection store, optional
    /// native MCP store, and the egress proxy's public address.
    pub fn new(
        connections: Arc<Connections>,
        native: Option<Arc<Native>>,
        base_url: impl Into<String>,
    ) -> Self {
        Self {
            connections,
            native,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        }
    }

    /// The owner's enabled Pipedream slugs, then authenticated custom servers.
    ///
    /// Pipedream `app_slug` is taken verbatim. Custom servers use a slugified
    /// ACP name, or `custom-{id}` when that name is empty, reserved, or taken.
    /// Macro's own server is not in the list. Disabled or unauthenticated
    /// native rows are left out.
    async fn advertised(&self, owner: &MacroUserIdStr<'static>) -> Result<Vec<AdvertisedMcp>> {
        let records = self.connections.list(owner).await.map_err(|error| {
            HarnessError::Egress(rootcause::report!(
                "could not list Pipedream connections: {error:?}"
            ))
        })?;

        let mut servers = Vec::new();
        let mut taken = HashSet::new();
        for record in records {
            if !record.enabled {
                continue;
            }
            let Some(slug) = McpServerSlug::parse(&record.app_slug) else {
                tracing::warn!(
                    %owner,
                    app_slug = %record.app_slug,
                    "a Pipedream connection's app slug is not a valid path segment; skipped"
                );
                continue;
            };
            taken.insert(slug.as_str().to_owned());
            servers.push(AdvertisedMcp::Pipedream(slug));
        }

        if let Some(native) = &self.native {
            let records = native.list(owner).await.map_err(|error| {
                HarnessError::Egress(rootcause::report!(
                    "could not list native MCP servers: {error:?}"
                ))
            })?;
            for record in records {
                if !(record.enabled && record.credentials.is_some()) {
                    continue;
                }
                let id = CustomMcpId::from_url(&record.url);
                let name = acp_name(&record.server_name, &id, &taken);
                taken.insert(name.clone());
                servers.push(AdvertisedMcp::Custom { id, name });
            }
        }

        tracing::debug!(
            mcp_servers = servers.len(),
            "advertising the owner's connected MCP servers"
        );
        Ok(servers)
    }
}

fn acp_name(server_name: &str, id: &CustomMcpId, taken: &HashSet<String>) -> String {
    let slug = slugify(server_name);
    if slug.is_empty() || slug == "macro" || taken.contains(&slug) {
        format!("custom-{id}")
    } else {
        slug
    }
}

fn slugify(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut prev_sep = false;
    for character in name.chars() {
        let to_push = if character.is_ascii_alphabetic() {
            character.to_ascii_lowercase()
        } else if character.is_ascii_digit() || character == '_' || character == '-' {
            character
        } else if character.is_whitespace() {
            '-'
        } else {
            continue;
        };
        if to_push == '-' {
            if !prev_sep && !result.is_empty() {
                result.push('-');
                prev_sep = true;
            }
        } else {
            result.push(to_push);
            prev_sep = false;
        }
    }
    result.trim_matches('-').to_owned()
}

impl<Connections, Native> SandboxEgressProvisioner for EgressProvisioner<Connections, Native>
where
    Connections: ConnectionStore,
    Native: McpServerStore,
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

        Ok(ProvisionedEgress {
            session_token_hash: token.hash(),
            sandbox: SandboxEgress {
                base_url: self.base_url.clone(),
                session_token: token.as_str().to_owned(),
                mcp_servers: self.advertised(owner).await?,
            },
        })
    }

    #[tracing::instrument(err, skip(self, session_token), fields(%owner))]
    async fn restore(
        &self,
        owner: &MacroUserIdStr<'static>,
        session_token: String,
    ) -> Result<SandboxEgress> {
        Ok(SandboxEgress {
            base_url: self.base_url.clone(),
            session_token,
            mcp_servers: self.advertised(owner).await?,
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
