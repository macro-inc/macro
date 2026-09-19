//! Associating a pull request with a session, regardless of its harness.

use std::pin::Pin;

use macro_user_id::user_id::MacroUserIdStr;

use super::error::{AgentSessionError, Result};
use super::model::{AgentSessionId, SessionClaim};
use super::ports::{AgentSessionRealtime, AgentSessionRepo};
use tracing::Instrument;

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
        claim: Option<SessionClaim>,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + 'a>>;
}

/// Persist the session's current PR independently of conversation history.
pub trait SessionPullRequestRepo: Send + Sync {
    /// Update only if the current URL differs; return whether the row changed.
    /// A supplied claim must match atomically with the write, even for an unchanged URL.
    fn record_pull_request(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        url: &str,
        claim: Option<SessionClaim>,
    ) -> impl Future<Output = Result<bool>> + Send;
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
        claim: Option<SessionClaim>,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + 'a>> {
        let span = tracing::info_span!(
            "agent.session.set_pull_request",
            agent.session.id = %session,
            outcome = tracing::field::Empty,
        );
        Box::pin(
            async move {
                let result = async {
                    let stored = self.repo.get(session).await?;
                    if &stored.owner_id != owner {
                        return Err(AgentSessionError::Forbidden);
                    }
                    let url = canonical_url(url)?;
                    let changed = self
                        .repo
                        .record_pull_request(session, owner, &url, claim)
                        .await?;
                    tracing::Span::current()
                        .record("outcome", if changed { "updated" } else { "unchanged" });
                    if changed {
                        // Persistence is authoritative; viewers refetch on reconnect.
                        if let Err(error) = self.realtime.publish_updated(session).await {
                            tracing::warn!(?error, "could not publish session metadata update");
                        }
                    }
                    Ok(url)
                }
                .await;
                if let Err(error) = &result {
                    tracing::Span::current().record(
                        "outcome",
                        if matches!(
                            error,
                            AgentSessionError::Forbidden | AgentSessionError::InvalidPullRequestUrl
                        ) {
                            "rejected"
                        } else {
                            "failed"
                        },
                    );
                    tracing::warn!(?error, "could not set session pull request");
                }
                result
            }
            .instrument(span),
        )
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
