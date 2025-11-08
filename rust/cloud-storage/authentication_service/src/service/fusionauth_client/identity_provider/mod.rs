use std::borrow::Cow;

use crate::service::fusionauth_client::{FusionAuthClient, Result};

mod link;
mod login;
mod lookup;
mod search;
mod unlink;

pub use link::*;

impl FusionAuthClient {
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn get_identity_provider_id_by_name(&self, name: &str) -> Result<String> {
        search::get_idp_id_by_name(&self.auth_client, &self.fusion_auth_base_url, name).await
    }

    /// This API is used to retrieve all Links for a specific user.
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn get_links(
        &self,
        user_id: &str,
        idp_id: Option<String>,
    ) -> Result<Vec<link::Link>> {
        link::get_links(
            &self.auth_client,
            &self.fusion_auth_base_url,
            user_id,
            idp_id,
        )
        .await
    }

    /// This API is used to create a link between a FusionAuth User and a user in a 3rd party identity provider. This API may be useful when you already know the unique Id of a user in a 3rd party identity provider and the corresponding FusionAuth User.
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url, user_id=%request.identity_provider_link.user_id, idp_id=%request.identity_provider_link.identity_provider_id))]
    pub async fn link_user(&self, request: LinkUserRequest<'_>) -> Result<()> {
        link::link_user(&self.auth_client, &self.fusion_auth_base_url, request).await
    }

    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn unlink_user(&self, user_id: &str, idp_id: &str, idp_user_id: &str) -> Result<()> {
        unlink::unlink(
            &self.auth_client,
            &self.fusion_auth_base_url,
            user_id,
            idp_id,
            idp_user_id,
        )
        .await
    }

    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn lookup_identity_provider(&self, domain: &str) -> Result<Option<String>> {
        lookup::get_idp_id_by_domain(&self.auth_client, &self.fusion_auth_base_url, domain).await
    }

    /// Completes the identity provider login
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn complete_identity_provider_login(
        &self,
        idp_id: &str,
        code: &str,
        redirect_uri: &str,
        no_link: bool,
    ) -> Result<(String, String)> {
        login::complete_identity_provider_login(
            &self.unauth_client,
            &self.fusion_auth_base_url,
            login::IdentityProviderLoginRequest {
                application_id: Cow::Borrowed(&self.application_id),
                identity_provider_id: Cow::Borrowed(idp_id),
                no_link,
                data: login::IdentityProviderLoginRequestData {
                    code: Cow::Borrowed(code),
                    redirect_uri: Cow::Borrowed(redirect_uri),
                },
            },
        )
        .await
    }
}
