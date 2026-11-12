use crate::{FusionAuthClient, Result};

mod refresh;
mod revoke;
#[cfg(test)]
mod test;

impl FusionAuthClient {
    /// Refreshes a JWT token using the provided access and refresh tokens.
    #[tracing::instrument(skip(self, access_token, refresh_token), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn refresh_token(
        &self,
        access_token: &str,
        refresh_token: &str,
    ) -> Result<(String, String)> {
        refresh::refresh_token(
            &self.unauth_client,
            &self.fusion_auth_base_url,
            access_token,
            refresh_token,
        )
        .await
    }

    /// Complete a one-time session-code login. Ordinary JWT refresh deliberately
    /// does not audit a new login; this distinct persistence boundary does.
    #[tracing::instrument(skip(self, access_token, refresh_token), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn complete_session_login(
        &self,
        access_token: &str,
        refresh_token: &str,
    ) -> Result<(String, String)> {
        let tokens = self.refresh_token(access_token, refresh_token).await?;
        self.audit_completed_login(&tokens.0).await?;
        Ok(tokens)
    }

    /// Revokes a refresh token so it can no longer be exchanged.
    #[tracing::instrument(skip_all, err, fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn revoke_refresh_token(&self, refresh_token: &str) -> Result<()> {
        revoke::revoke_refresh_token(&self.auth_client, &self.fusion_auth_base_url, refresh_token)
            .await
    }
}
