//! Who may see what a GitHub App installation delivers.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::GithubError;

/// The claim every installation check uses: the user installed it, or a team
/// they belong to did.
pub trait GithubInstallationClaims: Send + Sync + 'static {
    /// Whether `user` has a claim to the installation. False for an
    /// installation Macro has no record of.
    fn has_claim(
        &self,
        user: &MacroUserIdStr<'_>,
        installation_id: u64,
    ) -> impl Future<Output = Result<bool, GithubError>> + Send;
}
