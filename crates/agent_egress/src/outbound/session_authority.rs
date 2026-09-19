//! Turning the token a sandbox presents into the session row it stands for.
//!
//! One lookup, and it is the whole check. The token asserts nothing on its own
//! - it is 256 bits of randomness - so what a request may do is read off the
//! row it is stored against rather than out of the token: the owner whose
//! credentials it spends, the repository its git traffic is pinned to, and
//! whether the session is still open.
//!
//! That is what makes revocation real. A signed token has to be outlived or
//! denied by a second check; a token that is only a key into a table stops
//! working the moment the row does.
//!
//! What is stored is the token's SHA-256 digest, never the token, so a database
//! dump yields nothing that can be presented. Looking the row up *by* that
//! digest also keeps the comparison in the index rather than in a Rust `==`
//! over secret-derived bytes.

use agent_session::domain::ports::AgentSessionRepo;
use agent_session::domain::{credentials::authenticate_session, error::AgentSessionError};

use crate::domain::error::EgressError;
use crate::domain::model::{McpServerListing, McpServerSlug, RepoSlug, SessionGrant, SessionToken};
use crate::domain::ports::SessionAuthority;

/// Resolves a presented session token to its session by the digest stored
/// against that session, then checks the session is still open.
pub struct StoredTokenSessionAuthority<Sessions> {
    sessions: Sessions,
}

impl<Sessions> StoredTokenSessionAuthority<Sessions>
where
    Sessions: AgentSessionRepo,
{
    /// Build the authority over the session repository.
    pub fn new(sessions: Sessions) -> Self {
        Self { sessions }
    }
}

impl<Sessions> SessionAuthority for StoredTokenSessionAuthority<Sessions>
where
    Sessions: AgentSessionRepo,
{
    #[tracing::instrument(skip_all, err)]
    async fn authorize(&self, token: &SessionToken) -> Result<SessionGrant, EgressError> {
        let session = authenticate_session(&self.sessions, &token.hash())
            .await
            .map_err(|error| match error {
                AgentSessionError::Forbidden => {
                    EgressError::Unauthenticated("unknown session token")
                }
                AgentSessionError::Disconnected(_) => EgressError::SessionClosed,
                error => EgressError::Internal(rootcause::report!(
                    "could not authenticate session: {error}"
                )),
            })?;

        // A repository is optional for MCP-only sessions. The domain service
        // requires one only for git requests; a malformed stored URL still
        // indicates a configuration error.
        let repo = session
            .repo_url
            .as_deref()
            .map(|url| {
                RepoSlug::parse_github_url(url).ok_or_else(|| {
                    EgressError::Internal(rootcause::report!(
                        "session {} has an invalid github repository URL",
                        session.id
                    ))
                })
            })
            .transpose()?;

        // The agent's own names for the apps it listed, off the row's
        // snapshot, so a refusal can say "Google Sheets" rather than
        // "google_sheets". Not a permission: any slug resolves against the
        // owner's connections. A slug the strict parse refuses could never
        // have been advertised, so skipping it changes nothing the sandbox
        // can see.
        let mcp_servers = session
            .mcp_servers
            .servers()
            .iter()
            .filter_map(|server| {
                McpServerSlug::parse(&server.app_slug).map(|slug| McpServerListing {
                    slug,
                    name: server.server_name.clone(),
                })
            })
            .collect();

        Ok(SessionGrant {
            session: session.id,
            owner: session.owner_id,
            repo,
            mcp_servers,
        })
    }
}
