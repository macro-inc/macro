//! Who may see what a GitHub App installation delivers.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::GithubError;

/// What GitHub a user reaches through their currently linked account.
pub trait GithubInstallationClaims: Send + Sync + 'static {
    /// Whether `user` has linked a GitHub account.
    fn is_linked(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, GithubError>> + Send;

    /// Whether `user`, while linked, has a claim to the installation: a team
    /// they belong to installed it, or they installed it with the GitHub
    /// account linked now. False for an installation Macro has no record of.
    fn has_claim(
        &self,
        user: &MacroUserIdStr<'_>,
        installation_id: u64,
    ) -> impl Future<Output = Result<bool, GithubError>> + Send;

    /// The users among `users` who hold a claim to the installation, by the
    /// rule [`Self::has_claim`] states.
    ///
    /// The default asks [`Self::has_claim`] for each; the Postgres adapter
    /// answers in one read.
    fn claimants(
        &self,
        users: &[MacroUserIdStr<'static>],
        installation_id: u64,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, GithubError>> + Send {
        async move {
            let mut claimants = Vec::new();
            for user in users {
                if self.has_claim(user, installation_id).await? {
                    claimants.push(user.clone());
                }
            }
            Ok(claimants)
        }
    }
}
