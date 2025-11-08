use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct Oauth2<'a> {
    /// The authorization endpoint for the identity provider
    /// e.g https://acme.com/adfs/oauth2/authorize?client_id=cf3b00da-9551-460a-ad18-33232e6cbff0&response_type=code&redirect_uri=https://acme.com/oauth2/redirect
    authorization_endpoint: Cow<'a, str>,
    /// The token endpoint for the identity provider
    /// e.g https://acme.com/adfs/oauth2/token
    token_endpoint: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct IdentityProvider<'a> {
    /// The id of the identity provider
    id: Cow<'a, str>,
    /// The name of the identity provider
    name: Cow<'a, str>,
    /// The oauth2 configuration for the identity provider
    oauth2: Oauth2<'a>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct IdentityProviderLookupResponse<'a> {
    /// The identity provider returned from the lookup
    identity_provider: IdentityProvider<'a>,
}

/// Looksup identity providers based off of users email
/// If a match is found, it will return the identify provider's id to be used in the sso idp_hint
/// https://fusionauth.io/docs/apis/identity-providers/#lookup-an-identity-provider
/// Valid respones: 200, 400, 404, 500
pub(in crate::service::fusionauth_client) async fn get_idp_id_by_domain(
    client: &AuthedClient,
    base_url: &str,
    email: &str,
) -> Result<Option<String>> {
    let url_encoded_email = urlencoding::encode(email);
    let res = client
        .client()
        .get(format!(
            "{base_url}/api/identity-provider/lookup?domain={url_encoded_email}"
        ))
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            let response = res.json().await.map_err(|e| {
                tracing::error!(error=?e, "unable to parse response");
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            let response = serde_json::from_value::<IdentityProviderLookupResponse>(response)
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to parse response");
                    FusionAuthClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

            tracing::trace!(identity_provider=?response.identity_provider, "identity provider found");

            Ok(Some(response.identity_provider.id.into()))
        }
        reqwest::StatusCode::NOT_FOUND => {
            tracing::trace!("no identify provider matches domain");
            Ok(None)
        }
        _ => Err(FusionAuthClientError::Generic(GenericErrorResponse {
            message: "".to_string(),
        })),
    }
}
