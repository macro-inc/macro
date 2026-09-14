//! Associating a pull request with a session, regardless of its harness.

use std::pin::Pin;

use macro_user_id::user_id::MacroUserIdStr;

use super::error::{AgentSessionError, Result};
use super::model::{AgentSessionId, LogAppended, StoredAgentSessionLog};
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
}

/// Normalize a GitHub PR link, rejecting credentials and removing queries and fragments.
fn canonical_url(input: &str) -> Result<String> {
    let invalid = || AgentSessionError::InvalidPullRequestUrl;
    let (_, owner, repo, number) = lazy_regex::regex_captures!(
        r"\A(?i:https://github\.com)(?::443)?/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+)/pull/([0-9]+)/*(?:[?#][^\r\n]*)?\z",
        input
    )
    .ok_or_else(invalid)?;
    let number: u64 = number.parse().map_err(|_| invalid())?;
    if number == 0 {
        return Err(invalid());
    }
    Ok(format!("https://github.com/{owner}/{repo}/pull/{number}"))
}
