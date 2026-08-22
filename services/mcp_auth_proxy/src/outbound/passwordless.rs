//! Authentication service adapter for product passwordless login.

use anyhow::Context;
use reqwest::{StatusCode, Url, redirect::Policy};

use crate::domain::{
    models::{
        AccessToken, CompletePasswordless, OneTimeCode, PasswordlessStartResult, RefreshToken,
        StartPasswordless,
    },
    ports::{
        PasswordlessCompleteError, PasswordlessCompleteFuture, PasswordlessStartError,
        PasswordlessStartFuture, ProductPasswordless,
    },
};

#[derive(serde::Serialize)]
struct PasswordlessStartBody<'a> {
    email: &'a str,
    redirect_uri: &'a str,
}

#[derive(serde::Deserialize)]
struct PasswordlessStartedResponse {
    code: Option<String>,
}

#[derive(serde::Deserialize)]
struct SsoRequiredResponse {
    idp_id: String,
}

#[derive(serde::Deserialize)]
struct UserTokensResponse {
    access_token: String,
    refresh_token: String,
}

/// Product passwordless adapter backed by authentication service.
#[derive(Clone)]
pub struct AuthServicePasswordless {
    base_url: Url,
    client: reqwest::Client,
}

impl AuthServicePasswordless {
    /// Creates a passwordless adapter for an authentication service base URL.
    pub fn new(base_url: String) -> anyhow::Result<Self> {
        let mut base_url =
            Url::parse(&base_url).context("authentication service URL is invalid")?;
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .build()
            .context("failed to build authentication service HTTP client")?;
        Ok(Self { base_url, client })
    }
}

impl ProductPasswordless for AuthServicePasswordless {
    fn start<'a>(&'a self, command: StartPasswordless) -> PasswordlessStartFuture<'a> {
        Box::pin(async move {
            let url = self
                .base_url
                .join("login/passwordless")
                .map_err(|_| PasswordlessStartError::Unavailable)?;
            let response = self
                .client
                .post(url)
                .json(&PasswordlessStartBody {
                    email: command.email.as_str(),
                    redirect_uri: command.resume_uri.as_str(),
                })
                .send()
                .await
                .map_err(|_| PasswordlessStartError::Unavailable)?;

            match response.status() {
                StatusCode::OK => {
                    let body = response
                        .json::<PasswordlessStartedResponse>()
                        .await
                        .map_err(|_| PasswordlessStartError::Unavailable)?;
                    let local_otp = body
                        .code
                        .map(|code| OneTimeCode::parse(&code))
                        .transpose()
                        .map_err(|_| PasswordlessStartError::Unavailable)?;
                    Ok(PasswordlessStartResult::Sent { local_otp })
                }
                StatusCode::ACCEPTED => {
                    let body = response
                        .json::<SsoRequiredResponse>()
                        .await
                        .map_err(|_| PasswordlessStartError::Unavailable)?;
                    Ok(PasswordlessStartResult::SsoRequired {
                        idp_id: body.idp_id,
                    })
                }
                StatusCode::BAD_REQUEST => Err(PasswordlessStartError::InvalidEmail),
                StatusCode::TOO_MANY_REQUESTS => Err(PasswordlessStartError::RateLimited),
                _ => Err(PasswordlessStartError::Unavailable),
            }
        })
    }

    fn complete<'a>(&'a self, command: CompletePasswordless) -> PasswordlessCompleteFuture<'a> {
        Box::pin(async move {
            let mut url = self
                .base_url
                .join(&format!("oauth/passwordless/{}", command.otp.as_str()))
                .map_err(|_| PasswordlessCompleteError::Unavailable)?;
            url.query_pairs_mut()
                .append_pair("email", command.email.as_str())
                .append_pair("disable_redirect", "true");
            let response = self
                .client
                .get(url)
                .send()
                .await
                .map_err(|_| PasswordlessCompleteError::Unavailable)?;

            match response.status() {
                StatusCode::OK => {
                    let tokens = response
                        .json::<UserTokensResponse>()
                        .await
                        .map_err(|_| PasswordlessCompleteError::Unavailable)?;
                    Ok((
                        AccessToken::from(tokens.access_token),
                        RefreshToken::from(tokens.refresh_token),
                    ))
                }
                StatusCode::UNAUTHORIZED => Err(PasswordlessCompleteError::InvalidOtp),
                StatusCode::TOO_MANY_REQUESTS => Err(PasswordlessCompleteError::RateLimited),
                _ => Err(PasswordlessCompleteError::Unavailable),
            }
        })
    }
}
