use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct IdentityProvider<'a> {
    id: Cow<'a, str>,
    name: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct IdentityProviderSearchResponse<'a> {
    /// The identity providers returned from the search
    identity_providers: Vec<IdentityProvider<'a>>,
    /// The total number of identity providers returned from the search
    total: i32,
}

/// Searches through the list of identity providers and returns the identity provider id using the
/// name of the provider
/// https://fusionauth.io/docs/apis/identity-providers/#request-1
/// Valid respones: 200, 400, 401, 500
pub(in crate::service::fusionauth_client) async fn get_idp_id_by_name(
    client: &AuthedClient,
    base_url: &str,
    name: &str,
) -> Result<String> {
    let res = client
        .client()
        .get(format!(
            "{base_url}/api/identity-provider/search?name={name}"
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
            tracing::trace!("identity providers found");
            let body = res
                .json::<IdentityProviderSearchResponse>()
                .await
                .map_err(|e| {
                    FusionAuthClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

            if body.total == 0 {
                return Err(FusionAuthClientError::NoIdentityProviderFound);
            }

            if body.total > 1 {
                // attempt to match by idp name exactly. if we still have multiple providers,
                // return error
                let filtered_idps = body
                    .identity_providers
                    .into_iter()
                    .filter(|idp| idp.name == name)
                    .collect::<Vec<_>>();

                if filtered_idps.len() == 1 {
                    return Ok(filtered_idps[0].id.to_string());
                }

                return Err(FusionAuthClientError::Generic(GenericErrorResponse {
                    message: "multiple identity providers found".to_string(),
                }));
            }

            Ok(body.identity_providers[0].id.to_string())
        }
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
