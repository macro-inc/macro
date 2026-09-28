//! Claude Code's registered manual callback works across host/container boundaries.
use super::credentials::CLIENT_ID;
use crate::domain::{
    auth::OAuthProvider,
    model::{Credentials, Error, Secret},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const REDIRECT_URI: &str = "https://platform.claude.com/oauth/code/callback";
const SCOPES: &str = "user:profile user:inference user:sessions:claude_code";

/// HTTP OAuth adapter. Origins, redirect, client and scopes cannot be caller-controlled.
pub struct ClaudeOAuth {
    http: reqwest::Client,
}

impl ClaudeOAuth {
    /// Construct a bounded client without redirects or automatic mutation retries.
    pub fn new() -> Result<Self, Error> {
        Ok(Self {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| Error::Network)?,
        })
    }
}

impl OAuthProvider for ClaudeOAuth {
    fn authorization_url(&self, state: &str, verifier: &Secret) -> String {
        let mut url = reqwest::Url::parse("https://claude.com/cai/oauth/authorize")
            .expect("fixed OAuth origin");
        url.query_pairs_mut()
            .append_pair("code", "true")
            .append_pair("client_id", CLIENT_ID)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", REDIRECT_URI)
            .append_pair("scope", SCOPES)
            .append_pair("state", state)
            .append_pair(
                "code_challenge",
                &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.expose().as_bytes())),
            )
            .append_pair("code_challenge_method", "S256");
        url.into()
    }

    async fn exchange(
        &self,
        code: Secret,
        state: &str,
        verifier: Secret,
    ) -> Result<Credentials, Error> {
        let response = self.http.post("https://platform.claude.com/v1/oauth/token")
            .json(&serde_json::json!({ "grant_type": "authorization_code", "code": code.expose(),
                "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "state": state, "code_verifier": verifier.expose() }))
            .send().await.map_err(|_| Error::Network)?;
        #[derive(Deserialize)]
        struct Tokens {
            access_token: Secret,
            refresh_token: Option<Secret>,
            expires_in: u64,
            scope: String,
        }
        let tokens: Tokens = checked(response)?
            .json()
            .await
            .map_err(|_| Error::Protocol)?;
        if tokens.expires_in == 0
            || !SCOPES
                .split_whitespace()
                .all(|scope| tokens.scope.split_whitespace().any(|s| s == scope))
        {
            return Err(Error::Authorization);
        }
        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::Protocol)?
            .as_secs()
            .saturating_add(tokens.expires_in);
        let response = self
            .http
            .get("https://api.anthropic.com/api/oauth/profile")
            .bearer_auth(tokens.access_token.expose())
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|_| Error::Network)?;
        #[derive(Deserialize)]
        struct Organization {
            uuid: uuid::Uuid,
        }
        #[derive(Deserialize)]
        struct Profile {
            organization: Organization,
        }
        let profile: Profile = checked(response)?
            .json()
            .await
            .map_err(|_| Error::Protocol)?;
        let organization_id = profile.organization.uuid.to_string();
        let response = self
            .http
            .get("https://api.anthropic.com/v1/environments")
            .bearer_auth(tokens.access_token.expose())
            .header("anthropic-version", "2023-06-01")
            .header("x-organization-uuid", &organization_id)
            .header(
                "anthropic-beta",
                "environments-2026-03-01,environments-package-support-2025-12-09",
            )
            .send()
            .await
            .map_err(|_| Error::Network)?;
        let environments: serde_json::Value = checked(response)?
            .json()
            .await
            .map_err(|_| Error::Protocol)?;
        let mut candidates = environments["data"]
            .as_array()
            .ok_or(Error::Protocol)?
            .iter()
            .filter(|e| {
                e["config"]["type"] == "cloud"
                    && e["state"] == "active"
                    && e["archived_at"].is_null()
            });
        let environment_id = candidates
            .next()
            .and_then(|e| e["id"].as_str())
            .ok_or(Error::CloudEnvironment)?;
        if candidates.next().is_some() {
            return Err(Error::CloudEnvironment);
        }
        if !environment_id.starts_with("env_")
            || !environment_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err(Error::Protocol);
        }
        Ok(Credentials {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at,
            organization_id,
            environment_id: environment_id.to_owned(),
        })
    }
}

fn checked(response: reqwest::Response) -> Result<reqwest::Response, Error> {
    match response.status().as_u16() {
        200..=299 => Ok(response),
        400 | 401 | 403 => Err(Error::Authorization),
        status => Err(Error::Http(status)),
    }
}
