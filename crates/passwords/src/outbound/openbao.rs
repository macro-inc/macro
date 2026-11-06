//! Namespace-scoped OpenBao adapter. No provider response/error is included in tracing.
use crate::domain::{models::*, ports::SecretProvider};
use async_trait::async_trait;
use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use opentelemetry::trace::TraceContextExt;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tracing::instrument::WithSubscriber;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use vaultrs::{
    client::{Client, VaultClient, VaultClientSettings, VaultClientSettingsBuilder},
    kv2,
};

#[derive(Serialize, Deserialize)]
struct StoredSecret {
    operation_id: uuid::Uuid,
    values: SecretValues,
}

/// Namespace-isolated OpenBao KV v2 and TOTP adapter with short-lived team JWT login.
pub struct OpenBaoProvider {
    address: String,
    issuer: String,
    signing_key: Arc<EncodingKey>,
    http: reqwest::Client,
    settings: VaultClientSettings,
}
impl OpenBaoProvider {
    /// Required explicit URL, issuer and RSA key; no implicit Vault environment defaults.
    pub fn new(address: String, issuer: String, signing_key: &str) -> Result<Self, Error> {
        let url = reqwest::Url::parse(&address).map_err(|_| Error::Invalid)?;
        if !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(Error::Invalid);
        }
        let signing_key = Arc::new(
            EncodingKey::from_rsa_pem(signing_key.as_bytes()).map_err(|_| Error::Invalid)?,
        );
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .map_err(|_| Error::Unavailable)?;
        let settings = VaultClientSettingsBuilder::default()
            .address(&address)
            .token("")
            .namespace(None)
            .ca_certs(Vec::new())
            .identity(None)
            .verify(true)
            .timeout(Some(Duration::from_secs(10)))
            .build()
            .map_err(|_| Error::Invalid)?;
        Ok(Self {
            settings,
            address: address.trim_end_matches('/').into(),
            issuer,
            signing_key,
            http,
        })
    }
    #[tracing::instrument(skip_all, err, name = "passwords.openbao.authenticate")]
    async fn client(&self, team: TeamId) -> Result<VaultClient, Error> {
        #[derive(Serialize)]
        struct Claims<'a> {
            iss: &'a str,
            sub: &'a str,
            aud: &'a str,
            team_id: String,
            iat: i64,
            exp: i64,
            audit_id: String,
        }
        let now = Utc::now().timestamp();
        let jwt = SecretString(
            jsonwebtoken::encode(
                &Header::new(Algorithm::RS256),
                &Claims {
                    iss: &self.issuer,
                    sub: "macro-passwords-service",
                    aud: "macro-passwords",
                    team_id: team.0.to_string(),
                    iat: now,
                    exp: now + 60,
                    audit_id: tracing::Span::current()
                        .context()
                        .span()
                        .span_context()
                        .trace_id()
                        .to_string(),
                },
                &self.signing_key,
            )
            .map_err(|_| Error::Unavailable)?,
        );
        let mut settings = self.settings.clone();
        settings.namespace = Some(format!("team-{}", team.0));
        let middle = vaultrs::api::EndpointMiddleware {
            token: String::new(),
            version: "v1".into(),
            wrap: None,
            namespace: settings.namespace.clone(),
        };
        let http =
            rustify::clients::reqwest::Client::new(settings.address.as_str(), self.http.clone());
        let mut client = VaultClient {
            http,
            middle,
            settings,
        };
        let auth = quiet(vaultrs::auth::oidc::login(
            &client,
            "macro",
            &jwt.0,
            Some("passwords-service".into()),
        ))
        .await
        .map_err(|_| Error::Unavailable)?;
        client.set_token(&auth.client_token);
        Ok(client)
    }
    async fn totp_request(
        &self,
        team: TeamId,
        key_id: TotpKeyId,
        method: reqwest::Method,
        key: Option<&SecretString>,
        code: bool,
    ) -> Result<Option<TotpCode>, Error> {
        let client = self.client(team).await?;
        let token = SecretString(client.settings().token.clone());
        let endpoint = if code { "code" } else { "keys" };
        let mut request = self
            .http
            .request(
                method,
                format!("{}/v1/totp/{endpoint}/{}", self.address, key_id.0),
            )
            .header("X-Vault-Namespace", format!("team-{}", team.0))
            .header("X-Vault-Token", &token.0)
            .header(
                "x-macro-audit-id",
                tracing::Span::current()
                    .context()
                    .span()
                    .span_context()
                    .trace_id()
                    .to_string(),
            );
        if let Some(key) = key {
            request = request
                .json(&serde_json::json!({"key":key.0,"period":30,"digits":6,"algorithm":"SHA1"}));
        }
        let response = request.send().await.map_err(|_| Error::Unavailable)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND && !code && key.is_none() {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(Error::Unavailable);
        }
        if code {
            #[derive(Deserialize)]
            struct Envelope {
                data: Code,
            }
            #[derive(Deserialize)]
            struct Code {
                code: SecretString,
            }
            let value: Envelope = response.json().await.map_err(|_| Error::Unavailable)?;
            Ok(Some(TotpCode {
                code: value.data.code,
                period: 30,
            }))
        } else {
            Ok(None)
        }
    }
}
#[async_trait]
impl SecretProvider for OpenBaoProvider {
    #[tracing::instrument(skip_all,err,name="passwords.openbao.current_version",fields(team_id=%team.0,item_id=%item.0))]
    async fn current_version(&self, team: TeamId, item: ItemId) -> Result<Option<i32>, Error> {
        let client = self.client(team).await?;
        match quiet(kv2::read_metadata(
            &client,
            "passwords",
            &item.0.to_string(),
        ))
        .await
        {
            Ok(metadata) => Ok(Some(
                i32::try_from(metadata.current_version).map_err(|_| Error::Unavailable)?,
            )),
            Err(vaultrs::error::ClientError::APIError { code: 404, .. }) => Ok(None),
            Err(_) => Err(Error::Unavailable),
        }
    }
    #[tracing::instrument(skip_all,err,name="passwords.openbao.status",fields(team_id=%team.0,item_id=%item.0))]
    async fn status(&self, team: TeamId, item: ItemId) -> Result<Option<(i32, uuid::Uuid)>, Error> {
        let client = self.client(team).await?;
        let metadata = match quiet(kv2::read_metadata(
            &client,
            "passwords",
            &item.0.to_string(),
        ))
        .await
        {
            Ok(metadata) => metadata,
            Err(vaultrs::error::ClientError::APIError { code: 404, .. }) => return Ok(None),
            Err(_) => return Err(Error::Unavailable),
        };
        let stored: StoredSecret = quiet(kv2::read(&client, "passwords", &item.0.to_string()))
            .await
            .map_err(|_| Error::Unavailable)?;
        Ok(Some((
            i32::try_from(metadata.current_version).map_err(|_| Error::Unavailable)?,
            stored.operation_id,
        )))
    }
    #[tracing::instrument(skip_all, err, name = "passwords.openbao.write")]
    async fn write(
        &self,
        team: TeamId,
        item: ItemId,
        expected_version: i32,
        operation: uuid::Uuid,
        values: &SecretValues,
    ) -> Result<i32, Error> {
        let client = self.client(team).await?;
        let cas = u32::try_from(expected_version).map_err(|_| Error::Invalid)?;
        let result = quiet(kv2::set_with_options(
            &client,
            "passwords",
            &item.0.to_string(),
            &StoredSecret {
                operation_id: operation,
                values: values.clone(),
            },
            vaultrs::api::kv2::requests::SetSecretRequestOptions { cas },
        ))
        .await
        .map_err(|error| match error {
            vaultrs::error::ClientError::APIError { code: 400, .. } => Error::Conflict,
            _ => Error::Unavailable,
        })?;
        i32::try_from(result.version).map_err(|_| Error::Unavailable)
    }
    #[tracing::instrument(skip_all, err, name = "passwords.openbao.read")]
    async fn read(&self, team: TeamId, item: ItemId, version: i32) -> Result<SecretValues, Error> {
        let stored: StoredSecret = quiet(kv2::read_version(
            &self.client(team).await?,
            "passwords",
            &item.0.to_string(),
            u64::try_from(version).map_err(|_| Error::Invalid)?,
        ))
        .await
        .map_err(|_| Error::Unavailable)?;
        Ok(stored.values)
    }
    #[tracing::instrument(skip_all,err,name="passwords.openbao.delete",fields(team_id=%team.0,item_id=%item.0))]
    async fn delete(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
        let client = self.client(team).await?;
        let path = item.0.to_string();
        // Advance CAS before erasing: delayed pre-delete writes can never recreate values.
        for _ in 0..3 {
            let metadata = match quiet(kv2::read_metadata(&client, "passwords", &path)).await {
                Ok(metadata) => Some(metadata),
                Err(vaultrs::error::ClientError::APIError { code: 404, .. }) => None,
                Err(_) => return Err(Error::Unavailable),
            };
            let tombstone = StoredSecret {
                operation_id: uuid::Uuid::now_v7(),
                values: SecretValues {
                    username: SecretString(String::new()),
                    password: SecretString(String::new()),
                    notes: SecretString(String::new()),
                    fields: vec![],
                },
            };
            let cas = u32::try_from(
                metadata
                    .as_ref()
                    .map(|metadata| metadata.current_version)
                    .unwrap_or(0),
            )
            .map_err(|_| Error::Unavailable)?;
            match quiet(kv2::set_with_options(
                &client,
                "passwords",
                &path,
                &tombstone,
                vaultrs::api::kv2::requests::SetSecretRequestOptions { cas },
            ))
            .await
            {
                Ok(version) => {
                    let mut versions = Vec::new();
                    if let Some(metadata) = metadata {
                        for version in metadata.versions.keys() {
                            versions.push(version.parse::<u64>().map_err(|_| Error::Unavailable)?);
                        }
                    }
                    versions.push(version.version);
                    return quiet(kv2::destroy_versions(&client, "passwords", &path, versions))
                        .await
                        .map_err(|_| Error::Unavailable);
                }
                Err(vaultrs::error::ClientError::APIError { code: 400, .. }) => continue,
                Err(_) => return Err(Error::Unavailable),
            }
        }
        Err(Error::Conflict)
    }
    #[tracing::instrument(skip_all,err,name="passwords.openbao.history",fields(team_id=%team.0,item_id=%item.0))]
    async fn history(&self, team: TeamId, item: ItemId) -> Result<Vec<Version>, Error> {
        let metadata = quiet(kv2::read_metadata(
            &self.client(team).await?,
            "passwords",
            &item.0.to_string(),
        ))
        .await
        .map_err(|_| Error::Unavailable)?;
        let mut versions = Vec::new();
        for (version, metadata) in metadata.versions {
            if metadata.destroyed || !metadata.deletion_time.is_empty() {
                continue;
            }
            versions.push(Version {
                version: version.parse().map_err(|_| Error::Unavailable)?,
                created_at: metadata.created_time,
            });
        }
        versions.sort_by_key(|version| std::cmp::Reverse(version.version));
        Ok(versions)
    }
    #[tracing::instrument(skip_all,err,name="passwords.openbao.set_totp",fields(team_id=%team.0,key_id=%key_id.0))]
    async fn set_totp(
        &self,
        team: TeamId,
        key_id: TotpKeyId,
        key: &SecretString,
    ) -> Result<(), Error> {
        self.totp_request(team, key_id, reqwest::Method::POST, Some(key), false)
            .await?;
        Ok(())
    }
    #[tracing::instrument(skip_all,err,name="passwords.openbao.delete_totp",fields(team_id=%team.0,key_id=%key_id.0))]
    async fn delete_totp(&self, team: TeamId, key_id: TotpKeyId) -> Result<(), Error> {
        self.totp_request(team, key_id, reqwest::Method::DELETE, None, false)
            .await?;
        Ok(())
    }
    #[tracing::instrument(skip_all,err,name="passwords.openbao.totp",fields(team_id=%team.0,key_id=%key_id.0))]
    async fn totp(&self, team: TeamId, key_id: TotpKeyId) -> Result<TotpCode, Error> {
        self.totp_request(team, key_id, reqwest::Method::GET, None, true)
            .await?
            .ok_or(Error::Unavailable)
    }
}

// rustify traces raw provider error bodies; suppress its subscriber before any network polling.
async fn quiet<T>(future: impl std::future::Future<Output = T>) -> T {
    future
        .with_subscriber(tracing::subscriber::NoSubscriber::default())
        .await
}

/// Explicit unavailable state for installations that have not provisioned a vault.
pub struct UnavailableProvider;
#[async_trait]
impl SecretProvider for UnavailableProvider {
    async fn current_version(&self, _: TeamId, _: ItemId) -> Result<Option<i32>, Error> {
        Err(Error::Unavailable)
    }
    async fn status(&self, _: TeamId, _: ItemId) -> Result<Option<(i32, uuid::Uuid)>, Error> {
        Err(Error::Unavailable)
    }
    async fn write(
        &self,
        _: TeamId,
        _: ItemId,
        _: i32,
        _: uuid::Uuid,
        _: &SecretValues,
    ) -> Result<i32, Error> {
        Err(Error::Unavailable)
    }
    async fn read(&self, _: TeamId, _: ItemId, _: i32) -> Result<SecretValues, Error> {
        Err(Error::Unavailable)
    }
    async fn delete(&self, _: TeamId, _: ItemId) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
    async fn history(&self, _: TeamId, _: ItemId) -> Result<Vec<Version>, Error> {
        Err(Error::Unavailable)
    }
    async fn set_totp(&self, _: TeamId, _: TotpKeyId, _: &SecretString) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
    async fn delete_totp(&self, _: TeamId, _: TotpKeyId) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
    async fn totp(&self, _: TeamId, _: TotpKeyId) -> Result<TotpCode, Error> {
        Err(Error::Unavailable)
    }
}

#[cfg(test)]
mod test;
