//! Minting installation access tokens scoped to one repository, on a user's
//! behalf.
//!
//! Four steps, and the third is the one that matters:
//!
//! 1. sign a JWT proving we are the App
//! 2. find which installation of the App covers the repository
//! 3. check that installation belongs to the user, or to a team they are on
//! 4. mint a token cut down to that repository and the asked-for permissions
//!
//! Step 3 is not optional. Our App is installed across many accounts and its
//! JWT can mint a token for any of them, so without it a caller could name any
//! repository we can reach and be handed access to it. Step 4 is defence in
//! depth on top: an unscoped installation token covers every repository in the
//! installation, which is more than any single caller needs.
//!
//! This is deliberately its own service rather than a method on
//! [`GithubSyncServiceImpl`](super::GithubSyncServiceImpl). That type needs a
//! document service, a foreign-entity service and a notification ingress;
//! minting a token needs a database handle and an HTTP client, and a caller
//! that only wants a token should not have to construct the rest.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    GithubAppInstallationSource, GithubError, GithubInstallationAccessToken, app_jwt,
};
use crate::domain::ports::{GithubSyncClient, GithubSyncRepo};

#[cfg(test)]
mod test;

/// The GitHub App tokens are minted for.
pub struct InstallationTokenConfig {
    /// The App's client id, which GitHub wants as the JWT's `iss`.
    pub client_id: String,
    /// The App's RSA private key, PEM-encoded.
    pub private_key_pem: String,
}

/// Mints repository-scoped installation access tokens.
pub struct InstallationTokenService<Installations, Client> {
    config: InstallationTokenConfig,
    installations: Installations,
    client: Client,
}

impl<Installations, Client> InstallationTokenService<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    /// Build the service over the App's credentials, the installation records
    /// that say who owns which installation, and a GitHub client.
    pub fn new(
        config: InstallationTokenConfig,
        installations: Installations,
        client: Client,
    ) -> Self {
        Self {
            config,
            installations,
            client,
        }
    }

    /// A token for `owner`/`repository`, valid because `macro_user_id` may
    /// reach it.
    ///
    /// Returns [`GithubError::RepositoryUnavailable`] when the App is not
    /// installed on the repository *or* when the installation belongs to
    /// someone the user has no claim to - one answer for both, so the caller
    /// learns nothing about other people's accounts.
    #[tracing::instrument(skip(self, permissions), err, fields(%macro_user_id, owner, repository))]
    pub async fn for_repository(
        &self,
        macro_user_id: &MacroUserIdStr<'_>,
        owner: &str,
        repository: &str,
        permissions: &[(&str, &str)],
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        let jwt = app_jwt(&self.config.client_id, &self.config.private_key_pem)?;

        let installation = self
            .client
            .get_repository_installation(&jwt, owner, repository)
            .await?
            .ok_or_else(|| {
                tracing::warn!(owner, repository, "app is not installed on the repository");
                GithubError::RepositoryUnavailable
            })?;

        self.ensure_reachable(macro_user_id, installation).await?;

        self.client
            .generate_scoped_installation_access_token(&jwt, installation, repository, permissions)
            .await
    }

    /// Confirm `installation` was installed by this user or by a team they
    /// belong to.
    async fn ensure_reachable(
        &self,
        macro_user_id: &MacroUserIdStr<'_>,
        installation: u64,
    ) -> Result<(), GithubError> {
        let sources = self
            .installations
            .get_installation_sources(&installation.to_string())
            .await
            .map_err(|error| {
                GithubError::Internal(anyhow::anyhow!(
                    "could not read installation sources: {error:?}"
                ))
            })?;

        // Cheapest first: a personal installation needs no team lookup at all.
        if sources.iter().any(|source| {
            matches!(source, GithubAppInstallationSource::User(user) if user == macro_user_id.as_ref())
        }) {
            return Ok(());
        }

        let teams = self
            .installations
            .get_user_team_ids(macro_user_id.as_ref())
            .await
            .map_err(|error| {
                GithubError::Internal(anyhow::anyhow!("could not read user teams: {error:?}"))
            })?;

        if sources.iter().any(|source| {
            matches!(source, GithubAppInstallationSource::Team(team) if teams.contains(team))
        }) {
            return Ok(());
        }

        tracing::warn!(
            %macro_user_id,
            installation,
            "refused an installation the user has no claim to"
        );
        Err(GithubError::RepositoryUnavailable)
    }
}
