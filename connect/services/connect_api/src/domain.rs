use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("connection not found")]
    NotFound,
    #[error("connection needs reauthorization")]
    NeedsReauth,
    #[error("invalid customer key")]
    InvalidKey,
    #[error("storage failed: {0}")]
    Storage(rootcause::Report),
    #[error("grant encryption failed")]
    Cipher,
    #[error("invalid request: {0}")]
    InvalidRequest(&'static str),
    #[error("OAuth operation failed")]
    OAuth,
    #[error("authorization state not found")]
    InvalidState,
}

pub struct CustomerApiKey(Zeroizing<String>);

impl CustomerApiKey {
    pub fn new(value: String) -> Result<Self, Error> {
        let value = Zeroizing::new(value);
        let (id, secret) = value
            .strip_prefix("ck_")
            .and_then(|rest| rest.split_once('_'))
            .ok_or(Error::InvalidKey)?;
        if Uuid::parse_str(id).is_err()
            || secret.len() != 43
            || !secret
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err(Error::InvalidKey);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl std::fmt::Debug for CustomerApiKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CustomerApiKey([REDACTED])")
    }
}

impl std::ops::Deref for CustomerApiKey {
    type Target = str;
    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub app_id: String,
    pub status: ConnectionStatus,
    pub scopes: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Serialize, utoipa::ToSchema, strum::EnumString, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ConnectionStatus {
    Active,
    NeedsReauth,
}

pub struct Grant {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub scopes: Vec<String>,
}

impl std::fmt::Debug for Grant {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Grant([REDACTED])")
    }
}

impl Drop for Grant {
    fn drop(&mut self) {
        self.access_token.zeroize();
        if let Some(refresh_token) = &mut self.refresh_token {
            refresh_token.zeroize();
        }
        self.token_type.zeroize();
        for scope in &mut self.scopes {
            scope.zeroize();
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct GrantData {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub scopes: Vec<String>,
}

impl From<GrantData> for Grant {
    fn from(mut data: GrantData) -> Self {
        Self {
            access_token: std::mem::take(&mut data.access_token),
            refresh_token: data.refresh_token.take(),
            token_type: std::mem::take(&mut data.token_type),
            expires_at: data.expires_at,
            scopes: std::mem::take(&mut data.scopes),
        }
    }
}

impl From<&Grant> for GrantData {
    fn from(grant: &Grant) -> Self {
        Self {
            access_token: grant.access_token.clone(),
            refresh_token: grant.refresh_token.clone(),
            token_type: grant.token_type.clone(),
            expires_at: grant.expires_at,
            scopes: grant.scopes.clone(),
        }
    }
}

impl Drop for GrantData {
    fn drop(&mut self) {
        self.access_token.zeroize();
        if let Some(refresh_token) = &mut self.refresh_token {
            refresh_token.zeroize();
        }
        self.token_type.zeroize();
        for scope in &mut self.scopes {
            scope.zeroize();
        }
    }
}

pub struct Envelope {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encrypted_data_key: Vec<u8>,
    pub kms_key_id: String,
    pub encryption_version: i16,
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

pub struct StoredGrant {
    pub connection_id: Uuid,
    pub envelope: Envelope,
}

#[async_trait::async_trait]
pub trait GrantCipher: Send + Sync {
    async fn seal(
        &self,
        customer_id: Uuid,
        connection_id: Uuid,
        grant: &Grant,
    ) -> Result<Envelope, Error>;
    async fn open(
        &self,
        customer_id: Uuid,
        connection_id: Uuid,
        envelope: &Envelope,
    ) -> Result<Grant, Error>;
}

#[async_trait::async_trait]
pub trait Repository: Send + Sync {
    async fn authenticate(&self, key: &str) -> Result<Uuid, Error>;
    async fn list(&self, customer_id: Uuid, user_id: &str) -> Result<Vec<Connection>, Error>;
    async fn delete(&self, customer_id: Uuid, user_id: &str, app_id: &str) -> Result<bool, Error>;
    #[cfg(test)]
    async fn grant(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
    ) -> Result<Option<StoredGrant>, Error>;
}

pub struct Service {
    repository: std::sync::Arc<dyn Repository>,
}

impl Service {
    pub fn new(repository: std::sync::Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn authenticate(&self, key: &str) -> Result<Uuid, Error> {
        self.repository.authenticate(key).await
    }

    #[tracing::instrument(name = "connect.connections.list", skip_all, fields(customer_id = %customer_id, external_user_hash = %hash_user(user_id), outcome), err)]
    pub async fn list(&self, customer_id: Uuid, user_id: &str) -> Result<Vec<Connection>, Error> {
        let result = self.repository.list(customer_id, user_id).await;
        tracing::Span::current().record("outcome", if result.is_ok() { "ok" } else { "error" });
        result
    }

    #[tracing::instrument(name = "connect.connections.delete", skip_all, fields(customer_id = %customer_id, app_id = %app_id, external_user_hash = %hash_user(user_id), outcome), err)]
    pub async fn delete(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
    ) -> Result<bool, Error> {
        let result = self.repository.delete(customer_id, user_id, app_id).await;
        tracing::Span::current().record(
            "outcome",
            match result {
                Ok(true) => "deleted",
                Ok(false) => "not_found",
                Err(_) => "error",
            },
        );
        result
    }
}

pub mod oauth;

fn hash_user(user_id: &str) -> String {
    use sha2::Digest as _;
    format!("{:x}", sha2::Sha256::digest(user_id.as_bytes()))
}
