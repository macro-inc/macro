use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveLinkResponse {
    /// The link returned from the lookup - should only be one in the vec
    #[serde(rename = "identityProviderLinks")]
    idp_links: Vec<Link>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub display_name: String,
    pub identity_provider_id: String,
    pub identity_provider_name: String,
    pub identity_provider_type: String,
    pub identity_provider_user_id: String,
    pub insert_instant: u64,
    pub last_login_instant: u64,
    pub tenant_id: String,
    pub token: String,
    pub user_id: String,
}

/// Retrieves all links for a given user
/// If idp_id is provided, only links for that identity provider are returned
/// https://fusionauth.io/docs/apis/identity-providers/links#retrieve-a-link
/// Valid respones: 200, 400, 401, 404, 500
pub(in crate::service::fusionauth_client) async fn get_links(
    client: &AuthedClient,
    base_url: &str,
    user_id: &str,
    idp_id: Option<String>,
) -> Result<Vec<Link>> {
    let mut url = format!("{base_url}/api/identity-provider/link?userId={user_id}");

    if let Some(id) = idp_id {
        url.push_str(&format!("&identityProviderId={id}"));
    }

    let res = client.client().get(url).send().await.map_err(|e| {
        FusionAuthClientError::Generic(GenericErrorResponse {
            message: e.to_string(),
        })
    })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            let response: RetrieveLinkResponse = res.json().await.map_err(|e| {
                tracing::error!(error=?e, "unable to parse response");
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::trace!(identity_provider=?response.idp_links, "links found");

            Ok(response.idp_links)
        }
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;
            tracing::error!(body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: "unknown error".to_string(),
            }))
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdentityProviderLink<'a> {
    /// The display name
    pub display_name: Cow<'a, str>,
    /// The identity provider id
    pub identity_provider_id: Cow<'a, str>,
    /// The identity provider user id
    pub identity_provider_user_id: Cow<'a, str>,
    /// The user id
    pub user_id: Cow<'a, str>,
    /// The token
    pub token: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkUserRequest<'a> {
    /// The identity provider link
    pub identity_provider_link: IdentityProviderLink<'a>,
}

/// This API is used to create a link between a FusionAuth User and a user in a 3rd party identity provider. This API may be useful when you already know the unique Id of a user in a 3rd party identity provider and the corresponding FusionAuth User.
/// https://fusionauth.io/docs/apis/identity-providers/links#link-a-user
/// Valid respones: 200, 400, 401, 500, 504
pub(in crate::service::fusionauth_client) async fn link_user(
    client: &AuthedClient,
    base_url: &str,
    request: LinkUserRequest<'_>,
) -> Result<()> {
    let res = client
        .client()
        .post(format!("{base_url}/api/identity-provider/link",))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => Ok(()),
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::error!(body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}
