//! Domain models for the github crate.

#[cfg(test)]
mod test;

mod link;
mod pull_request;
mod sync;

pub use link::{GithubAccessToken, GithubExchangeTokenResponse, GithubLink, GithubUserInfo};
pub use pull_request::{
    EnrichGithubPullRequestsProxyRequest, EnrichGithubPullRequestsResponse,
    EnrichedGithubPullRequest, GithubPullRequestDetails, GithubPullRequestRef,
    GithubPullRequestStatus,
};
pub use sync::{
    GithubInstallationAccessToken, GithubKey, GithubWebhookEventType, MacroTaskId,
    TeamTaskReference, ValidatedGithubWebhookEvent,
};
/// Errors that can occur during github operations.
#[derive(Debug, thiserror::Error)]
pub enum GithubError {
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
    /// No Github link was found
    #[error("no link found")]
    NoLinkFound,
    /// Github account is already linked
    #[error("github account is already linked with another")]
    AccountAlreadyLinked,
    /// No refresh token was provided in the token exchange
    #[error("no refresh token provided in token exchange")]
    NoRefreshTokenProvided,
    /// Invalid github webhook signature
    #[error("invalid github webhook signature")]
    InvalidWebhookSignature,
}
