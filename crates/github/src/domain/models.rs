//! Domain models for the github crate.

#[cfg(test)]
mod test;

mod app_jwt;
mod installation_state;
mod link;
mod pull_request;
mod sync;

pub use app_jwt::AppJwt;
pub(crate) use app_jwt::app_jwt;
pub use installation_state::{
    InstallationState, InstallationStateError, sign_installation_state, verify_installation_state,
};
pub use link::{GithubAccessToken, GithubExchangeTokenResponse, GithubLink, GithubUserInfo};
pub use pull_request::{
    EnrichGithubPullRequestsProxyRequest, EnrichGithubPullRequestsResponse,
    EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
    GithubPullRequestCheckRun, GithubPullRequestComment, GithubPullRequestDetails,
    GithubPullRequestRef, GithubPullRequestStatus,
};
pub use sync::{
    GithubAppInstallationSource, GithubAuthenticatedUser, GithubInstallationAccessToken,
    GithubInstallationSetupAction, GithubKey, GithubSetupAccessToken, GithubUserInstallation,
    GithubUserInstallationsPage, GithubWebhookEventType, MacroTaskId, ResolvedTeamTaskReference,
    TeamTaskReference, ValidatedGithubWebhookEvent, extract_github_mentions, strip_markdown_code,
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
    /// The Github link token has expired and the user must reauthenticate.
    #[error("reauthentication required")]
    ReauthenticationRequired,
    /// No refresh token was provided in the token exchange
    #[error("no refresh token provided in token exchange")]
    NoRefreshTokenProvided,
    /// Invalid github webhook signature
    #[error("invalid github webhook signature")]
    InvalidWebhookSignature,
    /// The authenticated user is not a member of the requested team.
    #[error("user is not permitted to configure GitHub sync for this team")]
    Forbidden,
    /// The installation setup state is malformed, invalid, or expired.
    #[error("invalid installation setup state")]
    InvalidInstallationState,
    /// GitHub reported an unsupported installation setup action.
    #[error("invalid installation setup action")]
    InvalidInstallationSetupAction,
    /// A required installation callback field was absent.
    #[error("missing installation setup callback field: {0}")]
    MissingInstallationSetupField(&'static str),
    /// The installation is not visible to the GitHub user who completed setup.
    #[error("GitHub installation is not owned by the setup user")]
    InstallationNotOwned,
    /// The GitHub account completing setup is not linked to the Macro user the
    /// setup state was minted for.
    #[error("GitHub account is not linked to the Macro user who started setup")]
    SetupUserNotLinked,
    /// Our App has no installation covering the requested repository, or the
    /// installation it has belongs to neither the requesting user nor any team
    /// they are on.
    ///
    /// One variant for both because a caller must not be able to tell them
    /// apart: "installed, but not yours" and "not installed" differ only in
    /// what they report about other people's accounts.
    #[error("no GitHub App installation for this user and repository")]
    RepositoryUnavailable,
}
