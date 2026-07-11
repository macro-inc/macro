use std::borrow::Cow;
use std::collections::HashMap;

use crate::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Structured shape of FusionAuth validation error responses.
/// See https://fusionauth.io/docs/v1/tech/apis/errors
#[derive(serde::Deserialize, Debug, Default)]
struct FusionAuthErrorBody {
    #[serde(default, rename = "fieldErrors")]
    field_errors: HashMap<String, Vec<FusionAuthFieldError>>,
}

#[derive(serde::Deserialize, Debug)]
struct FusionAuthFieldError {
    code: String,
}

impl FusionAuthErrorBody {
    /// Returns true if any field error carries the FusionAuth `[alreadyLinked]` code,
    /// regardless of which field triggered it.
    fn is_already_linked(&self) -> bool {
        self.field_errors
            .values()
            .flatten()
            .any(|e| e.code.starts_with("[alreadyLinked]"))
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
/// Response containing identity provider links.
pub struct RetrieveLinkResponse {
    /// The link returned from the lookup - should only be one in the vec
    #[serde(rename = "identityProviderLinks")]
    idp_links: Vec<Link>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
/// An identity provider link.
pub struct Link {
    /// The display name for this link.
    pub display_name: String,
    /// The identity provider ID.
    pub identity_provider_id: String,
    /// The name of the identity provider.
    pub identity_provider_name: String,
    /// The type of the identity provider.
    pub identity_provider_type: String,
    /// The user ID on the identity provider side.
    pub identity_provider_user_id: String,
    /// The instant when the link was created.
    pub insert_instant: u64,
    /// The instant of the last login using this link.
    pub last_login_instant: u64,
    /// The tenant ID.
    pub tenant_id: String,
    /// The token associated with this link.
    pub token: String,
    /// The FusionAuth user ID.
    pub user_id: String,
}

/// Retrieves all links for a given user
/// If idp_id is provided, only links for that identity provider are returned
/// https://fusionauth.io/docs/apis/identity-providers/links#retrieve-a-link
/// Valid respones: 200, 400, 401, 404, 500
pub(crate) async fn get_links(
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
/// An identity provider link for creating a link.
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
/// Request to link a user to an identity provider.
pub struct LinkUserRequest<'a> {
    /// The identity provider link
    pub identity_provider_link: IdentityProviderLink<'a>,
}

/// This API is used to create a link between a FusionAuth User and a user in a 3rd party identity provider. This API may be useful when you already know the unique Id of a user in a 3rd party identity provider and the corresponding FusionAuth User.
/// https://fusionauth.io/docs/apis/identity-providers/links#link-a-user
/// Valid respones: 200, 400, 401, 500, 504
pub(crate) async fn link_user(
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

            if serde_json::from_str::<FusionAuthErrorBody>(&body)
                .ok()
                .as_ref()
                .is_some_and(FusionAuthErrorBody::is_already_linked)
            {
                tracing::info!(body=%body, "fusionauth idp link already exists");
                return Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists);
            }

            tracing::error!(body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}
