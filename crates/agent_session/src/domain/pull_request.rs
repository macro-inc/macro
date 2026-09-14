//! Associating a pull request with a session, regardless of its harness.

use std::pin::Pin;

use macro_user_id::user_id::MacroUserIdStr;

use super::error::{AgentSessionError, Result};
use super::model::{AgentSessionId, LogAppended, SessionStatus, StoredAgentSessionLog};
use super::ports::{AgentSessionRealtime, AgentSessionRepo};

#[cfg(test)]
mod test;

/// The shared operation used by a provider adapter and the session MCP tool.
pub trait SessionPullRequests: Send + Sync {
    /// Set the owner's session PR. Repeating the current URL changes nothing.
    fn set_pull_request<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        url: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + 'a>>;

    /// Resolve an authenticated session tool invocation. Cursor supplies its PR
    /// through its adapter and does not expose this tool to its agent.
    fn tool_session<'a>(
        &'a self,
        token_hash: &'a str,
        owner: &'a MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentSessionId>> + Send + 'a>>;
}

/// Atomic storage of a session's PR, serialized with history replacement.
pub trait SessionPullRequestRepo: Send + Sync {
    /// Append only if the current URL differs, under the session row lock.
    fn record_pull_request(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        url: &str,
    ) -> impl Future<Output = Result<Option<StoredAgentSessionLog>>> + Send;
}

/// Session PR operations over the session store and its realtime publisher.
pub struct SessionPullRequestService<R, Rt> {
    repo: R,
    realtime: Rt,
}

impl<R, Rt> SessionPullRequestService<R, Rt> {
    /// Build the service using the same store and publisher as session logs.
    pub fn new(repo: R, realtime: Rt) -> Self {
        Self { repo, realtime }
    }
}

impl<R, Rt> SessionPullRequests for SessionPullRequestService<R, Rt>
where
    R: AgentSessionRepo + SessionPullRequestRepo,
    Rt: AgentSessionRealtime + Send + Sync,
{
    fn set_pull_request<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        url: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + 'a>> {
        Box::pin(async move {
            let stored = self.repo.get(session).await?;
            if &stored.owner_id != owner {
                return Err(AgentSessionError::Forbidden);
            }
            let url = canonical_url(url)?;
            let Some(entry) = self.repo.record_pull_request(session, owner, &url).await? else {
                return Ok(url);
            };
            // The durable event is authoritative; reconnect catches up if delivery fails.
            self.realtime.publish(LogAppended { agent_session_id: session, entry }).await
                .inspect_err(|error| tracing::warn!(error = ?error, %session, "could not publish session pull request"))
                .ok();
            Ok(url)
        })
    }

    fn tool_session<'a>(
        &'a self,
        token_hash: &'a str,
        owner: &'a MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentSessionId>> + Send + 'a>> {
        Box::pin(async move {
            let session = self
                .repo
                .find_by_egress_token_hash(token_hash)
                .await?
                .ok_or(AgentSessionError::Forbidden)?;
            if &session.owner_id != owner || session.harness == "cursor" {
                return Err(AgentSessionError::Forbidden);
            }
            if matches!(
                session.status,
                SessionStatus::Disconnected
                    | SessionStatus::Event(
                        agent_runtime_protocol::domain::schema::v0::SystemEvent::Disconnected
                    )
            ) {
                return Err(AgentSessionError::Disconnected(session.id));
            }
            Ok(session.id)
        })
    }
}

/// Normalize a GitHub PR link, excluding credentials, fragments and queries.
fn canonical_url(input: &str) -> Result<String> {
    let invalid = || AgentSessionError::InvalidPullRequestUrl;
    let url = url::Url::parse(input).map_err(|_| invalid())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(invalid());
    }
    let parts: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
    if parts.len() != 5
        || parts[3] != "pull"
        || !parts[1..3].iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        return Err(invalid());
    }
    let number: u64 = parts[4].parse().map_err(|_| invalid())?;
    if number == 0 {
        return Err(invalid());
    }
    Ok(format!(
        "https://github.com/{}/{}/pull/{number}",
        parts[1], parts[2]
    ))
}
