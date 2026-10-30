use chrono::{Duration, Utc};
use rmcp::transport::auth::{
    AuthorizationManager, InMemoryStateStore, OAuthClientConfig, StateStore as _,
};
use url::Url;
use zeroize::{Zeroize as _, Zeroizing};

use crate::domain::{
    Error, Grant,
    oauth::{Authorization, Client, Metadata, OAuthProvider, RefreshError},
};

pub struct VendorOAuth {
    http: reqwest::Client,
}

#[derive(serde::Deserialize)]
struct TokenBody {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
}

impl Drop for TokenBody {
    fn drop(&mut self) {
        self.access_token.zeroize();
        if let Some(value) = &mut self.refresh_token {
            value.zeroize();
        }
    }
}

impl TokenBody {
    fn into_grant(
        mut self,
        fallback_refresh: Option<&str>,
        fallback_scopes: &[String],
    ) -> Result<Grant, Error> {
        let token_type = self.token_type.take().unwrap_or_else(|| "Bearer".into());
        if !token_type.eq_ignore_ascii_case("Bearer") {
            return Err(Error::OAuth);
        }
        let expires_at = self
            .expires_in
            .map(|seconds| {
                Utc::now()
                    .checked_add_signed(Duration::seconds(seconds))
                    .ok_or(Error::OAuth)
            })
            .transpose()?;
        Ok(Grant {
            access_token: std::mem::take(&mut self.access_token),
            refresh_token: self
                .refresh_token
                .take()
                .or_else(|| fallback_refresh.map(str::to_owned)),
            token_type,
            expires_at,
            scopes: self
                .scope
                .take()
                .map(|value| value.split_whitespace().map(str::to_owned).collect())
                .unwrap_or_else(|| fallback_scopes.to_vec()),
        })
    }
}

#[derive(serde::Deserialize)]
struct TokenError {
    error: String,
}

impl VendorOAuth {
    pub fn new() -> Result<Self, Error> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::OAuth)?;
        Ok(Self { http })
    }

    async fn manager(
        &self,
        server_url: &str,
        client: Option<&Client>,
        redirect_uri: &str,
    ) -> Result<AuthorizationManager, Error> {
        let mut manager = AuthorizationManager::new(server_url)
            .await
            .map_err(|_| Error::OAuth)?;
        let metadata = manager
            .discover_metadata()
            .await
            .map_err(|_| Error::OAuth)?;
        manager.set_metadata(metadata);
        if let Some(client) = client {
            let mut config = OAuthClientConfig::new(&client.id, redirect_uri);
            if let Some(secret) = &client.secret {
                config = config.with_client_secret(secret.to_string());
            }
            manager.configure_client(config).map_err(|_| Error::OAuth)?;
        }
        Ok(manager)
    }
}

#[async_trait::async_trait]
impl OAuthProvider for VendorOAuth {
    #[tracing::instrument(name = "connect.oauth.discover", skip_all, err)]
    async fn discover(&self, server_url: &str) -> Result<Metadata, Error> {
        let manager = AuthorizationManager::new(server_url)
            .await
            .map_err(|_| Error::OAuth)?;
        let metadata = manager
            .discover_metadata()
            .await
            .map_err(|_| Error::OAuth)?;
        let issuer = metadata.issuer.ok_or(Error::OAuth)?;
        let supports_cimd = metadata
            .additional_fields
            .get("client_id_metadata_document_supported")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        Ok(Metadata {
            issuer,
            supports_cimd,
            supports_dcr: metadata.registration_endpoint.is_some(),
        })
    }

    #[tracing::instrument(name = "connect.oauth.register", skip_all, err)]
    async fn register(
        &self,
        server_url: &str,
        redirect_uri: &str,
        scopes: &[String],
    ) -> Result<Client, Error> {
        let mut manager = self.manager(server_url, None, redirect_uri).await?;
        let scope_refs: Vec<&str> = scopes.iter().map(String::as_str).collect();
        let config = manager
            .register_client("Macro Connect", redirect_uri, &scope_refs)
            .await
            .map_err(|_| Error::OAuth)?;
        Ok(Client {
            id: config.client_id,
            secret: config.client_secret.map(Zeroizing::new),
            kind: connect_registry::ClientRegistration::Dcr,
        })
    }

    #[tracing::instrument(name = "connect.oauth.authorization_url", skip_all, err)]
    async fn authorize(
        &self,
        server_url: &str,
        redirect_uri: &str,
        client: &Client,
        scopes: &[String],
    ) -> Result<Authorization, Error> {
        let mut manager = self.manager(server_url, Some(client), redirect_uri).await?;
        let state_store = InMemoryStateStore::new();
        manager.set_state_store(state_store.clone());
        let refs: Vec<&str> = scopes.iter().map(String::as_str).collect();
        let url = manager
            .get_authorization_url(&refs)
            .await
            .map_err(|_| Error::OAuth)?;
        let state = Url::parse(&url)
            .map_err(|_| Error::OAuth)?
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.into_owned())
            .ok_or(Error::OAuth)?;
        let stored = state_store
            .load(&state)
            .await
            .map_err(|_| Error::OAuth)?
            .ok_or(Error::OAuth)?;
        Ok(Authorization {
            url,
            state,
            verifier: Zeroizing::new(stored.pkce_verifier),
        })
    }

    #[tracing::instrument(name = "connect.oauth.exchange", skip_all, err)]
    async fn exchange(
        &self,
        server_url: &str,
        redirect_uri: &str,
        client: &Client,
        verifier: &str,
        code: &str,
        requested_scopes: &[String],
    ) -> Result<Grant, Error> {
        let manager = AuthorizationManager::new(server_url)
            .await
            .map_err(|_| Error::OAuth)?;
        let metadata = manager
            .discover_metadata()
            .await
            .map_err(|_| Error::OAuth)?;
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client.id.as_str()),
            ("code_verifier", verifier),
            ("resource", server_url),
        ];
        let mut request = self.http.post(&metadata.token_endpoint);
        if let Some(secret) = &client.secret {
            if secret_post(&metadata) {
                form.push(("client_secret", secret.as_str()));
            } else {
                request = request.basic_auth(&client.id, Some(secret.as_str()));
            }
        }
        let response = request.form(&form).send().await.map_err(|_| Error::OAuth)?;
        if !response.status().is_success() {
            return Err(Error::OAuth);
        }
        let body: TokenBody = response.json().await.map_err(|_| Error::OAuth)?;
        body.into_grant(None, requested_scopes)
    }

    #[tracing::instrument(name = "connect.oauth.refresh_http", skip_all, fields(outcome), err)]
    async fn refresh(
        &self,
        server_url: &str,
        _redirect_uri: &str,
        client: &Client,
        grant: &Grant,
    ) -> Result<Grant, RefreshError> {
        let refresh_token = grant
            .refresh_token
            .as_deref()
            .ok_or(RefreshError::InvalidGrant)?;
        let manager = AuthorizationManager::new(server_url)
            .await
            .map_err(|_| RefreshError::Other(Error::OAuth))?;
        let metadata = manager
            .discover_metadata()
            .await
            .map_err(|_| RefreshError::Other(Error::OAuth))?;
        let mut form = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client.id.as_str()),
        ];
        let mut request = self.http.post(&metadata.token_endpoint);
        if let Some(secret) = &client.secret {
            if secret_post(&metadata) {
                form.push(("client_secret", secret.as_str()));
            } else {
                request = request.basic_auth(&client.id, Some(secret.as_str()));
            }
        }
        let response = request
            .form(&form)
            .send()
            .await
            .map_err(|_| RefreshError::Other(Error::OAuth))?;
        let status = response.status();
        if !status.is_success() {
            let body: TokenError = response
                .json()
                .await
                .map_err(|_| RefreshError::Other(Error::OAuth))?;
            if body.error == "invalid_grant" {
                tracing::Span::current().record("outcome", "invalid_grant");
                return Err(RefreshError::InvalidGrant);
            }
            tracing::Span::current().record("outcome", "error");
            return Err(RefreshError::Other(Error::OAuth));
        }
        let body: TokenBody = response
            .json()
            .await
            .map_err(|_| RefreshError::Other(Error::OAuth))?;
        tracing::Span::current().record("outcome", "refreshed");
        body.into_grant(grant.refresh_token.as_deref(), &grant.scopes)
            .map_err(RefreshError::Other)
    }
}

fn secret_post(metadata: &rmcp::transport::auth::AuthorizationMetadata) -> bool {
    metadata
        .additional_fields
        .get("token_endpoint_auth_methods_supported")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|methods| {
            methods
                .iter()
                .any(|value| value.as_str() == Some("client_secret_post"))
                && !methods
                    .iter()
                    .any(|value| value.as_str() == Some("client_secret_basic"))
        })
}
