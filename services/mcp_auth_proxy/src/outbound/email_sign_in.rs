//! Emailed sign-in codes, through the authentication service's public login
//! endpoints.
//!
//! The authentication service owns this flow for the Macro app: its address
//! checks, per-address rate limits, single sign-on routing, and signup policy all
//! apply here without the broker repeating them. The limits count per address,
//! so every sign-in arriving from this one caller does not share a budget.

#[cfg(test)]
mod test;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use model::{
    authentication::login::{request::PasswordlessRequest, response::SsoRequiredResponse},
    response::UserTokensResponse,
};
use reqwest::{StatusCode, header::HeaderMap};
use tracing::Instrument;
use url::Url;

use crate::domain::{
    models::{EmailCodeRequest, UpstreamTokens},
    ports::{EmailCodeError, EmailCodeProvider, EmailCodeRequestFuture, EmailCodeTokensFuture},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Emailed sign-in codes backed by the authentication service.
#[derive(Clone)]
pub struct AuthServiceEmailCodes {
    client: reqwest::Client,
    auth_service_url: Url,
    redirect_uri: String,
}

impl AuthServiceEmailCodes {
    /// Creates a provider calling the authentication service at
    /// `auth_service_url`. `redirect_uri` fills the endpoint's required field;
    /// redeeming with redirects disabled never sends a browser there.
    pub fn new(auth_service_url: &str, redirect_uri: String) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .context("failed to build authentication service client")?;
        let auth_service_url =
            Url::parse(auth_service_url).context("invalid authentication service URL")?;

        Ok(Self {
            client,
            auth_service_url,
            redirect_uri,
        })
    }

    /// The service URL with `segments` appended to its path, which already
    /// holds a gateway prefix outside local development.
    fn endpoint(&self, segments: &[&str]) -> Result<Url, EmailCodeError> {
        let mut url = self.auth_service_url.clone();
        url.path_segments_mut()
            .map_err(|()| {
                EmailCodeError::Unavailable(anyhow::anyhow!(
                    "authentication service URL cannot be a base"
                ))
            })?
            .pop_if_empty()
            .extend(segments);
        Ok(url)
    }
}

fn trace_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    headers
}

fn unavailable(context: &'static str) -> impl FnOnce(reqwest::Error) -> EmailCodeError {
    move |error| EmailCodeError::Unavailable(anyhow::Error::new(error).context(context))
}

/// Seconds until an access token expires, from its `exp` claim. The service
/// issued it over this connection, so the signature is not what is in question;
/// the endpoint simply does not report a lifetime.
fn seconds_until_expiry(access_token: &str) -> anyhow::Result<u64> {
    #[derive(serde::Deserialize)]
    struct Claims {
        exp: u64,
    }

    let payload = access_token
        .split('.')
        .nth(1)
        .context("access token is not a JWT")?;
    let payload = URL_SAFE_NO_PAD
        .decode(payload)
        .context("access token payload is not base64")?;
    let claims: Claims =
        serde_json::from_slice(&payload).context("access token payload has no expiry")?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before the epoch")?
        .as_secs();

    Ok(claims.exp.saturating_sub(now))
}

impl EmailCodeProvider for AuthServiceEmailCodes {
    fn request_code<'a>(&'a self, email: &'a str) -> EmailCodeRequestFuture<'a> {
        let span = tracing::debug_span!("mcp_oauth.email_code.request");
        Box::pin(
            async move {
                let response = self
                    .client
                    .post(self.endpoint(&["login", "passwordless"])?)
                    .headers(trace_headers())
                    .json(&PasswordlessRequest {
                        email: email.to_owned(),
                        redirect_uri: self.redirect_uri.clone(),
                        referral_code: None,
                        is_agent: false,
                    })
                    .send()
                    .await
                    .map_err(unavailable("failed to call the authentication service"))?;

                match response.status() {
                    StatusCode::OK => Ok(EmailCodeRequest::Sent),
                    StatusCode::ACCEPTED => {
                        let sso: SsoRequiredResponse = response
                            .json()
                            .await
                            .map_err(unavailable("failed to read the single sign-on response"))?;
                        Ok(EmailCodeRequest::SsoRequired { idp_id: sso.idp_id })
                    }
                    StatusCode::BAD_REQUEST => Err(EmailCodeError::InvalidEmail),
                    StatusCode::FORBIDDEN => Err(EmailCodeError::NotAllowed),
                    StatusCode::TOO_MANY_REQUESTS => Err(EmailCodeError::RateLimited),
                    status => Err(EmailCodeError::Unavailable(anyhow::anyhow!(
                        "authentication service answered {status} when sending a code"
                    ))),
                }
            }
            .instrument(span),
        )
    }

    fn redeem_code<'a>(&'a self, email: &'a str, code: &'a str) -> EmailCodeTokensFuture<'a> {
        let span = tracing::debug_span!("mcp_oauth.email_code.redeem");
        Box::pin(
            async move {
                // The service files a code under the lowercased address when it
                // sends it, but looks it up with the casing it is given here.
                let email = email.to_lowercase();
                let response = self
                    .client
                    .get(self.endpoint(&["oauth", "passwordless", code])?)
                    .query(&[("email", email.as_str()), ("disable_redirect", "true")])
                    .headers(trace_headers())
                    .send()
                    .await
                    .map_err(unavailable("failed to call the authentication service"))?;

                match response.status() {
                    StatusCode::OK => {}
                    StatusCode::BAD_REQUEST => return Err(EmailCodeError::InvalidEmail),
                    StatusCode::UNAUTHORIZED => return Err(EmailCodeError::InvalidCode),
                    StatusCode::TOO_MANY_REQUESTS => return Err(EmailCodeError::RateLimited),
                    status => {
                        return Err(EmailCodeError::Unavailable(anyhow::anyhow!(
                            "authentication service answered {status} when redeeming a code"
                        )));
                    }
                }

                let tokens: UserTokensResponse = response
                    .json()
                    .await
                    .map_err(unavailable("failed to read the sign-in tokens"))?;
                let expires_in = seconds_until_expiry(&tokens.access_token)
                    .map_err(EmailCodeError::Unavailable)?;

                Ok(UpstreamTokens {
                    access_token: tokens.access_token.into(),
                    refresh_token: tokens.refresh_token.into(),
                    expires_in,
                })
            }
            .instrument(span),
        )
    }
}
