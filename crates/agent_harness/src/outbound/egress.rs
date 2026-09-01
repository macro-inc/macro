//! Handing a sandbox its one secret, and telling opencode where to spend it.
//!
//! Three adapter concerns the domain has no business with: minting a token,
//! listing the owner's Pipedream-connected apps (which needs their rows), and
//! asking the agent's configuration which of those apps the session may use.
//!
//! Both the minting and the hashing are `agent_egress`'s, not a second
//! implementation of either. The two ends of this token are written in
//! different crates and read months apart, and a hash computed differently at
//! each end reads at runtime as "every request from every sandbox is
//! unauthenticated".

use agent_egress::domain::model::{McpServerSlug, RepoSlug, SessionToken};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::ConnectionStore;
use std::sync::Arc;
use url::Url;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{McpServerRef, McpServerSelection, ProvisionedEgress, SandboxEgress};
use crate::domain::ports::{AgentRuntimeDirectory, SandboxEgressProvisioner};
use agent_session::domain::model::AgentSessionId;

#[cfg(test)]
mod test;

/// The only host a configured repository URL may name. Validating the
/// deployment's own configuration, not a request: a URL pointing somewhere else
/// would mint a session token for a repository the proxy cannot reach.
const GITHUB_HOST: &str = "github.com";

/// Mints session tokens and gathers the MCP servers a sandbox may dial.
pub struct EgressProvisioner<Connections, Runtimes> {
    connections: Arc<Connections>,
    runtimes: Arc<Runtimes>,
    base_url: String,
}

impl<Connections, Runtimes> EgressProvisioner<Connections, Runtimes>
where
    Connections: ConnectionStore,
    Runtimes: AgentRuntimeDirectory,
{
    /// Build the provisioner over the Pipedream connection store, the
    /// directory that knows each agent's MCP selection, and the egress
    /// proxy's public address.
    pub fn new(
        connections: Arc<Connections>,
        runtimes: Arc<Runtimes>,
        base_url: impl Into<String>,
    ) -> Self {
        Self {
            connections,
            runtimes,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        }
    }

    /// Which of the owner's servers `bot`'s sessions are handed.
    ///
    /// A bot the directory does not know gets only Macro's own server: a
    /// session is being opened for it, so refusing outright would be wrong,
    /// but handing an unconfigured agent every credential its owner holds
    /// would be worse.
    async fn selection(&self, bot: BotId) -> Result<McpServerSelection> {
        match self.runtimes.runtime_for(bot).await? {
            Some(runtime) => Ok(runtime.mcp_servers),
            None => {
                tracing::warn!(%bot, "no runtime configuration for the session's bot; advertising no connected MCP servers");
                Ok(McpServerSelection::Selected(Vec::new()))
            }
        }
    }

    /// The slugs of the owner's enabled Pipedream connections that `bot`'s
    /// configuration lets its sessions use, verbatim.
    ///
    /// `app_slug`, exactly as the proxy resolves it - the same value at both
    /// ends by equality is what makes a server entry dialable, and there is
    /// no derivation for the two to disagree over. Macro's own server is not
    /// in the list: every session has it, on its own route. An app the owner
    /// turned off is left out here as well as refused by the proxy: an agent
    /// that can see a server in its list will try it, and a tool call that
    /// always fails is worse than a tool that is absent. An app the agent
    /// names but the owner never connected is left out for the same reason,
    /// and because the owner's credentials are the only ones a session spends.
    async fn slugs(
        &self,
        owner: &MacroUserIdStr<'static>,
        bot: BotId,
    ) -> Result<Vec<McpServerSlug>> {
        let selection = self.selection(bot).await?;
        let records = self.connections.list(owner).await.map_err(|error| {
            HarnessError::Egress(rootcause::report!(
                "could not list Pipedream connections: {error:?}"
            ))
        })?;

        let connected: Vec<McpServerSlug> = records
            .into_iter()
            .filter(|record| record.enabled)
            .filter_map(|record| {
                let slug = McpServerSlug::parse(&record.app_slug);
                if slug.is_none() {
                    // An app slug the strict parse refuses could never be
                    // dialed - the proxy would refuse the same path segment -
                    // so leaving it out is the only honest rendering.
                    tracing::warn!(
                        %owner,
                        app_slug = %record.app_slug,
                        "a Pipedream connection's app slug is not a valid path segment; skipped"
                    );
                }
                slug
            })
            .collect();

        let slugs = match selection {
            McpServerSelection::AllConnected => connected,
            McpServerSelection::Selected(servers) => servers
                .iter()
                .filter_map(|server| match server {
                    McpServerRef::Pipedream { app_slug } => {
                        let slug = connected.iter().find(|slug| slug.as_str() == app_slug);
                        if slug.is_none() {
                            tracing::debug!(
                                %owner,
                                %bot,
                                app_slug,
                                "the agent names a Pipedream app the owner has not connected; skipped"
                            );
                        }
                        slug.cloned()
                    }
                    // The proxy resolves only Pipedream-connected apps today;
                    // a native-stack server has no route it could be
                    // advertised under, so it is left out rather than listed
                    // as something the agent will fail to dial.
                    McpServerRef::Native { url } => {
                        tracing::warn!(
                            %owner,
                            %bot,
                            url,
                            "the agent names a native MCP server, which the egress proxy does not yet serve; skipped"
                        );
                        None
                    }
                })
                .collect(),
        };
        tracing::debug!(
            mcp_servers = slugs.len(),
            "advertising the owner's connected MCP servers"
        );
        Ok(slugs)
    }
}

impl<Connections, Runtimes> SandboxEgressProvisioner for EgressProvisioner<Connections, Runtimes>
where
    Connections: ConnectionStore,
    Runtimes: AgentRuntimeDirectory,
{
    #[tracing::instrument(err, skip(self), fields(%session, %owner, %bot))]
    async fn provision(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        bot: BotId,
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
                mcp_servers: self.slugs(owner, bot).await?,
            },
        })
    }

    #[tracing::instrument(err, skip(self, session_token), fields(%owner, %bot))]
    async fn restore(
        &self,
        owner: &MacroUserIdStr<'static>,
        bot: BotId,
        session_token: String,
    ) -> Result<SandboxEgress> {
        Ok(SandboxEgress {
            base_url: self.base_url.clone(),
            session_token,
            mcp_servers: self.slugs(owner, bot).await?,
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
