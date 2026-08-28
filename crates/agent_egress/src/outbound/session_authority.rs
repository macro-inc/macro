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

use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use agent_session::domain::model::SessionStatus;
use agent_session::domain::ports::AgentSessionRepo;

use crate::domain::error::EgressError;
use crate::domain::model::{RepoSlug, SessionGrant, SessionToken};
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
        // A lookup that failed is a refusal too - this decides whether a
        // credential gets spent, and the safe answer when we cannot tell is no
        // - but a refusal of a different kind from a token we do not know, and
        // the sandbox should retry one and not the other.
        let session = self
            .sessions
            .find_by_egress_token_hash(&token.hash())
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "could not look up a session by its token");
            })
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not look up a session by its token: {error}"
                ))
            })?
            // No row is the ordinary refusal: a token we never minted, or one
            // whose session has since been deleted. Both are the same fact
            // from here, and neither is worth telling the sandbox apart.
            .ok_or(EgressError::Unauthenticated("unknown session token"))?;

        // `SessionStatus` has no "closed" of its own; a disconnected transport
        // is what a closed session looks like from the row. Anything else -
        // including an event name this build does not know - is a running
        // session, because a session that has not been told to stop is one
        // whose sandbox may still be mid-tool-call.
        if matches!(
            session.status,
            SessionStatus::Disconnected | SessionStatus::Event(SystemEvent::Disconnected)
        ) {
            return Err(EgressError::SessionClosed);
        }

        // Our own configuration, not sandbox input - but it is interpolated
        // into a GitHub URL downstream, so it is parsed rather than trusted. A
        // row that does not name a repository is a session that was created
        // wrong, which is ours to fix and not something the sandbox can retry
        // its way out of.
        //
        // `repo_url` is nullable because an external session names no
        // repository, but such a session is never issued an egress token, so
        // reaching here without one is that same "created wrong" - not a
        // refusal the sandbox could act on.
        let repo = session
            .repo_url
            .as_deref()
            .and_then(RepoSlug::parse_github_url)
            .ok_or_else(|| {
                EgressError::Internal(rootcause::report!(
                    "session {} has no repo_url naming a github repository",
                    session.id
                ))
            })?;

        Ok(SessionGrant {
            session: session.id,
            owner: session.owner_id,
            repo,
        })
    }
}
