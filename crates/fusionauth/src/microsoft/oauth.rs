use std::time::Duration;

use anyhow::Context;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::Url;

use crate::{
    Result, UnauthedClient,
    error::{FusionAuthClientError, GenericErrorResponse},
};

const MICROSOFT_LOGIN_BASE_URL: &str = "https://login.microsoftonline.com/";
const MICROSOFT_SCOPES: &str = "openid email offline_access profile Mail.ReadWrite Mail.Send";

#[derive(serde::Serialize)]
struct MicrosoftTokenExchangeRequest<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    code: &'a str,
    grant_type: &'static str,
    redirect_uri: &'a str,
}

#[derive(serde::Deserialize)]
struct MicrosoftTokenExchangePayload {
    refresh_token: String,
    id_token: String,
}

/// Tokens returned by a Microsoft authorization-code exchange.
pub struct MicrosoftExchangeTokenResponse {
    /// The refresh token used to request future Microsoft Graph access tokens.
    pub refresh_token: String,
    /// The ID token containing the linked Microsoft identity.
    pub id_token: String,
}

#[derive(serde::Deserialize)]
struct MicrosoftIdTokenClaims {
    aud: String,
    tid: String,
    sub: String,
    email: Option<String>,
    preferred_username: Option<String>,
}

/// Validated identity details extracted from a Microsoft ID token.
#[derive(Debug, Eq, PartialEq)]
pub struct MicrosoftUserInfo {
    /// The tenant-specific Microsoft subject identifier.
    pub sub: String,
    /// The email claim, or `preferred_username` when the email claim is absent.
    pub email: String,
}

pub(crate) fn construct_authorize_url<T>(
    client_id: &str,
    tenant_id: &str,
    redirect_uri: &str,
    state: &T,
) -> anyhow::Result<String>
where
    T: serde::Serialize + ?Sized,
{
    let mut url = endpoint_url(tenant_id, "authorize")?;
    let serialized_state =
        serde_json::to_string(state).context("failed to serialize Microsoft OAuth state")?;

    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", MICROSOFT_SCOPES)
        .append_pair("state", &serialized_state)
        .append_pair("prompt", "select_account");

    Ok(url.to_string())
}

pub(crate) async fn exchange_code_for_tokens(
    client: &UnauthedClient,
    client_id: &str,
    client_secret: &str,
    tenant_id: &str,
    redirect_uri: &str,
    code: &str,
) -> Result<MicrosoftExchangeTokenResponse> {
    let token_endpoint = endpoint_url(tenant_id, "token").map_err(FusionAuthClientError::from)?;
    let request = MicrosoftTokenExchangeRequest {
        client_id,
        client_secret,
        code,
        grant_type: "authorization_code",
        redirect_uri,
    };

    let response = client
        .client()
        .post(token_endpoint)
        .form(&request)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| {
            tracing::error!(error=?error, "failed to send Microsoft token request");
            generic_error(error.to_string())
        })?;
    let status = response.status();

    if !status.is_success() {
        let error_body = response.text().await.map_err(|error| {
            tracing::error!(error=?error, "failed to read Microsoft token error response");
            generic_error(error.to_string())
        })?;
        tracing::error!(?status, body=?error_body, "Microsoft token exchange failed");
        return Err(generic_error(format!(
            "Microsoft token exchange failed with status {status}: {error_body}"
        )));
    }

    let payload = response
        .json::<MicrosoftTokenExchangePayload>()
        .await
        .map_err(|error| {
            tracing::error!(error=?error, "failed to parse Microsoft token response");
            generic_error(error.to_string())
        })?;

    if payload.refresh_token.trim().is_empty() {
        return Err(generic_error(
            "Microsoft token response did not include a refresh token",
        ));
    }
    if payload.id_token.trim().is_empty() {
        return Err(generic_error(
            "Microsoft token response did not include an ID token",
        ));
    }

    Ok(MicrosoftExchangeTokenResponse {
        refresh_token: payload.refresh_token,
        id_token: payload.id_token,
    })
}

pub(crate) fn decode_microsoft_id_token(
    id_token: &str,
    expected_audience: &str,
    expected_tenant_id: &str,
) -> anyhow::Result<MicrosoftUserInfo> {
    let mut token_parts = id_token.split('.');
    let _header = token_parts.next();
    let payload = token_parts.next().context("invalid JWT format")?;
    let _signature = token_parts.next().context("invalid JWT format")?;
    if token_parts.next().is_some() {
        anyhow::bail!("invalid JWT format");
    }

    let decoded_payload = URL_SAFE_NO_PAD
        .decode(payload)
        .context("failed to decode Microsoft ID-token claims")?;
    let claims: MicrosoftIdTokenClaims = serde_json::from_slice(&decoded_payload)
        .context("failed to deserialize Microsoft ID-token claims")?;

    if claims.aud != expected_audience {
        anyhow::bail!("Microsoft ID-token audience does not match the configured client");
    }
    if claims.tid != expected_tenant_id {
        anyhow::bail!("Microsoft ID-token tenant does not match the configured tenant");
    }
    if claims.sub.trim().is_empty() {
        anyhow::bail!("Microsoft ID token does not contain a subject");
    }

    let email = claims
        .email
        .filter(|email| !email.trim().is_empty())
        .or_else(|| {
            claims
                .preferred_username
                .filter(|username| !username.trim().is_empty())
        })
        .context("Microsoft ID token does not contain an email or preferred username")?;

    Ok(MicrosoftUserInfo {
        sub: claims.sub,
        email,
    })
}

fn endpoint_url(tenant_id: &str, endpoint: &str) -> anyhow::Result<Url> {
    let mut url =
        Url::parse(MICROSOFT_LOGIN_BASE_URL).context("invalid Microsoft OAuth base URL")?;
    url.path_segments_mut()
        .expect("Microsoft OAuth base URL must support path segments")
        .pop_if_empty()
        .extend([tenant_id, "oauth2", "v2.0", endpoint]);
    Ok(url)
}

fn generic_error(message: impl Into<String>) -> FusionAuthClientError {
    FusionAuthClientError::Generic(GenericErrorResponse {
        message: message.into(),
    })
}
