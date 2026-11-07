//! Direct HTTP implementation of the device flow observed in Codex and OpenCode.

use crate::domain::{
    Credentials, DeviceLogin, Environment, EnvironmentRepository, LoginPoll, OAuth, Secret,
    unix_now,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, de::DeserializeOwned};
use std::time::Duration;

#[cfg(test)]
mod test;

mod environments;
mod tasks;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER: &str = "https://auth.openai.com";
const CLOUD: &str = "https://chatgpt.com/backend-api";
const MAX_BODY: usize = 1024 * 1024;

/// Fixed production origins; endpoint overrides are only available inside tests.
pub struct OpenAi {
    client: Client,
    issuer: String,
    cloud: String,
}

impl OpenAi {
    /// Build a client with bounded requests and redirects disabled.
    pub fn new() -> Result<Self, rootcause::Report> {
        Ok(Self {
            client: Client::builder()
                .user_agent(concat!("macro-codex-probe/", env!("CARGO_PKG_VERSION")))
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()?,
            issuer: ISSUER.to_owned(),
            cloud: CLOUD.to_owned(),
        })
    }

    async fn tokens(&self, form: &[(&str, &str)]) -> Result<Tokens, rootcause::Report> {
        let response = self
            .client
            .post(format!("{}/oauth/token", self.issuer))
            .form(form)
            .send()
            .await
            .map_err(|_| rootcause::report!("token request failed (network/timeout)"))?;
        decode(response, "token exchange/refresh").await
    }
}

impl OAuth for OpenAi {
    async fn begin(&self) -> Result<DeviceLogin, rootcause::Report> {
        let response = self
            .client
            .post(format!("{}/api/accounts/deviceauth/usercode", self.issuer))
            .json(&serde_json::json!({"client_id": CLIENT_ID}))
            .send()
            .await
            .map_err(|_| rootcause::report!("device login request failed (network/timeout)"))?;
        let device: DeviceResponse = decode(
            response,
            "start device login (enable device login in ChatGPT settings if unavailable)",
        )
        .await?;
        let interval = match device.interval {
            Some(Interval::Text(value)) => value
                .trim()
                .parse::<u64>()
                .map_err(|_| rootcause::report!("invalid device polling interval"))?,
            Some(Interval::Number(value)) => value,
            None => 5,
        };
        // Never poll faster than the server requested. The login itself is bounded.
        let interval = interval
            .max(1)
            .checked_add(3)
            .ok_or_else(|| rootcause::report!("invalid device polling interval"))?;
        if device.user_code.is_empty()
            || device.user_code.len() > 128
            || device.user_code.chars().any(char::is_control)
        {
            return Err(rootcause::report!("invalid device user code"));
        }
        Ok(DeviceLogin {
            verification_url: format!("{}/codex/device", self.issuer),
            user_code: device.user_code,
            device_auth_id: Secret::new(device.device_auth_id)?,
            interval: Duration::from_secs(interval),
            timeout: Duration::from_secs(device.expires_in.unwrap_or(900).min(900)),
        })
    }

    async fn poll(&self, login: &DeviceLogin) -> Result<LoginPoll, rootcause::Report> {
        let response = self.client.post(format!("{}/api/accounts/deviceauth/token", self.issuer))
            .json(&serde_json::json!({"device_auth_id": login.device_auth_id.expose(), "user_code": login.user_code}))
            .send().await.map_err(|_| rootcause::report!("device poll failed (network/timeout)"))?;
        // These two pending statuses match both supplied implementations.
        if matches!(
            response.status(),
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
        ) {
            return Ok(LoginPoll::Pending);
        }
        let code: CodeResponse = decode(response, "device verification").await?;
        let redirect = format!("{}/deviceauth/callback", self.issuer);
        let tokens = self
            .tokens(&[
                ("grant_type", "authorization_code"),
                ("client_id", CLIENT_ID),
                ("code", code.authorization_code.expose()),
                ("code_verifier", code.code_verifier.expose()),
                ("redirect_uri", &redirect),
            ])
            .await?;
        Ok(LoginPoll::Complete(tokens.credentials(None, unix_now()?)?))
    }

    async fn refresh(&self, current: &Credentials) -> Result<Credentials, rootcause::Report> {
        self.tokens(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", current.refresh_token.expose()),
        ])
        .await?
        .credentials(Some(current), unix_now()?)
    }

    async fn environments(
        &self,
        credentials: &Credentials,
    ) -> Result<Vec<Environment>, rootcause::Report> {
        let response = self
            .client
            .get(format!("{}/wham/environments", self.cloud))
            .bearer_auth(credentials.access_token.expose())
            .header("ChatGPT-Account-Id", &credentials.account_id)
            .header("originator", "macro-codex-probe")
            .send()
            .await
            .map_err(|_| rootcause::report!("environment request failed (network/timeout)"))?;
        let environments: Vec<environments::ProviderEnvironment> =
            decode(response, "list cloud environments").await?;
        environments
            .into_iter()
            .map(environments::ProviderEnvironment::project)
            .collect()
    }
}

async fn response_body(
    mut response: Response,
    operation: &str,
) -> Result<zeroize::Zeroizing<Vec<u8>>, rootcause::Report> {
    let status = response.status();
    if !status.is_success() {
        // Never include provider bodies: error payloads can echo credentials.
        return Err(rootcause::report!(
            "{operation}: HTTP {status}; no automatic retry. For 401/invalid grant, log in again"
        ));
    }
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| rootcause::report!("provider response interrupted"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_BODY {
            return Err(rootcause::report!("provider response exceeds 1 MiB limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn decode<T: DeserializeOwned>(
    response: Response,
    operation: &str,
) -> Result<T, rootcause::Report> {
    let bytes = response_body(response, operation).await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| rootcause::report!("{operation}: unexpected response shape (body withheld)"))
}

async fn native_body(response: Response, operation: &str) -> Result<String, rootcause::Report> {
    let bytes = response_body(response, operation).await?;
    String::from_utf8(bytes.to_vec())
        .map_err(|_| rootcause::report!("{operation}: response was not UTF-8 (body withheld)"))
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Interval {
    Text(String),
    Number(u64),
}

#[derive(Deserialize)]
struct DeviceResponse {
    device_auth_id: String,
    #[serde(alias = "usercode")]
    user_code: String,
    interval: Option<Interval>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct CodeResponse {
    authorization_code: Secret,
    code_verifier: Secret,
}

#[derive(Deserialize)]
struct Tokens {
    access_token: Secret,
    refresh_token: Option<Secret>,
    id_token: Option<Secret>,
    expires_in: Option<u64>,
}

#[derive(Deserialize, Default)]
struct Claims {
    exp: Option<u64>,
    chatgpt_account_id: Option<String>,
    #[serde(rename = "https://api.openai.com/auth")]
    auth: Option<AccountClaims>,
}
#[derive(Deserialize)]
struct AccountClaims {
    chatgpt_account_id: Option<String>,
}

impl Claims {
    fn read(token: &Secret) -> Self {
        token
            .expose()
            .split('.')
            .nth(1)
            .and_then(|part| URL_SAFE_NO_PAD.decode(part).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
    fn account(self) -> Option<String> {
        self.chatgpt_account_id
            .or_else(|| self.auth.and_then(|auth| auth.chatgpt_account_id))
    }
}

impl Tokens {
    fn credentials(
        self,
        previous: Option<&Credentials>,
        now: u64,
    ) -> Result<Credentials, rootcause::Report> {
        let access_claims = Claims::read(&self.access_token);
        let expires_at = self
            .expires_in
            .and_then(|seconds| now.checked_add(seconds))
            .or(access_claims.exp)
            .filter(|expiry| *expiry > now)
            .ok_or_else(|| rootcause::report!("token response has no usable expiry"))?;
        let account_id = access_claims
            .account()
            .or_else(|| {
                self.id_token
                    .as_ref()
                    .and_then(|token| Claims::read(token).account())
            })
            .or_else(|| previous.map(|old| old.account_id.clone()))
            .ok_or_else(|| rootcause::report!("token response has no ChatGPT account ID"))?;
        let refresh_token = match self.refresh_token {
            Some(token) => token,
            None => Secret::new(
                previous
                    .ok_or_else(|| rootcause::report!("login response has no refresh token"))?
                    .refresh_token
                    .expose()
                    .to_owned(),
            )?,
        };
        let credentials = Credentials {
            version: 1,
            access_token: self.access_token,
            refresh_token,
            expires_at,
            account_id,
        };
        credentials.validate()?;
        Ok(credentials)
    }
}
