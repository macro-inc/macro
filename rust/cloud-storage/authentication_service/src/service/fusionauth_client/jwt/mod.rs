use crate::service::fusionauth_client::{FusionAuthClient, Result};

mod refresh;

impl FusionAuthClient {
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
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
}
