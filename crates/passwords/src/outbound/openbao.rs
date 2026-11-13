//! Namespace-scoped OpenBao adapter. No provider response/error is included in tracing.
use crate::domain::{models::*, ports::SecretProvider};
use async_trait::async_trait;
use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use opentelemetry::trace::TraceContextExt;
use serde::{Deserialize, Serialize};
use std::{future::Future, sync::Arc, time::Duration};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use openbao_client::{Cause, OpenBaoClient, Session};

mod token_cache;
use token_cache::TokenCache;

#[derive(Serialize, Deserialize)]
struct StoredSecret {
    operation_id: uuid::Uuid,
    values: SecretValues,
}

#[derive(Clone, Copy)]
enum NamespaceAccess {
    Values,
    Lifecycle,
}

/// Namespace-isolated OpenBao KV v2 and TOTP adapter. Each team's short-lived
/// JWT-login token is reused until shortly before its lease ends.
pub struct OpenBaoProvider {
    issuer: String,
    signing_key: Arc<EncodingKey>,
    api: OpenBaoClient,
    tokens: TokenCache,
}

/// A provider call's failure: a typed provider cause, which may be a rejected
/// token, or an already-mapped domain failure.
enum CallError {
    Provider(openbao_client::Error),
    Domain(Error),
}

impl From<openbao_client::Error> for CallError {
    fn from(error: openbao_client::Error) -> Self {
        Self::Provider(error)
    }
}

impl From<Error> for CallError {
    fn from(error: Error) -> Self {
        Self::Domain(error)
    }
}

impl From<CallError> for Error {
    fn from(error: CallError) -> Self {
        match error {
            CallError::Provider(error) => provider_error(error),
            CallError::Domain(error) => error,
        }
    }
}

impl OpenBaoProvider {
    /// Explicit origin, issuer and RSA key; no environment credentials or root token.
    pub fn new(address: String, issuer: String, signing_key: &str) -> Result<Self, Error> {
        let api = OpenBaoClient::new(&address).map_err(provider_error)?;
        let signing_key = Arc::new(
            EncodingKey::from_rsa_pem(signing_key.as_bytes()).map_err(|_| Error::Invalid)?,
        );
        Ok(Self {
            issuer,
            signing_key,
            api,
            tokens: TokenCache::new(token_cache::CAPACITY),
        })
    }

    #[tracing::instrument(skip_all, err, name = "passwords.openbao.authenticate")]
    async fn login(&self, team: TeamId) -> Result<Session, Error> {
        self.authenticated_client(team, NamespaceAccess::Values)
            .await
    }

    /// Runs `call` with the team's token. When the provider rejects a cached
    /// token, the token is replaced and `call` runs once more from the start,
    /// so every `call` must be safe to re-run after a 401/403: rejected
    /// requests are not applied, and multi-request steps are CAS-fenced or
    /// idempotent. A freshly issued token that is rejected is a policy denial;
    /// it is neither retried nor evicted.
    async fn with_session<Output, Call, Pending>(
        &self,
        team: TeamId,
        call: Call,
    ) -> Result<Output, Error>
    where
        Call: Fn(Session) -> Pending,
        Pending: Future<Output = Result<Output, CallError>>,
    {
        let lease = self.tokens.session(team, || self.login(team)).await?;
        let span = tracing::Span::current();
        span.set_attribute("cache_hit", lease.cache_hit);
        match call(lease.session.clone()).await {
            Err(CallError::Provider(error))
                if error.cause() == Cause::Authentication && lease.cache_hit => {}
            outcome => return outcome.map_err(Error::from),
        }
        span.set_attribute("token_retry", true);
        let retry = self
            .tokens
            .replace(team, &lease, || self.login(team))
            .await?;
        call(retry.session.clone()).await.map_err(Error::from)
    }

    async fn authenticated_client(
        &self,
        team: TeamId,
        access: NamespaceAccess,
    ) -> Result<Session, Error> {
        let (subject, audience) = match access {
            NamespaceAccess::Values => ("macro-passwords-service", "macro-passwords"),
            NamespaceAccess::Lifecycle => {
                ("macro-passwords-lifecycle", "macro-passwords-lifecycle")
            }
        };
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
        let audit_id = audit_id();
        let jwt = openbao_client::SecretString::new(
            jsonwebtoken::encode(
                &Header::new(Algorithm::RS256),
                &Claims {
                    iss: &self.issuer,
                    sub: subject,
                    aud: audience,
                    team_id: team.0.to_string(),
                    iat: now,
                    exp: now + 60,
                    audit_id: audit_id.clone(),
                },
                &self.signing_key,
            )
            .map_err(|_| Error::Unavailable)?,
        );
        match access {
            NamespaceAccess::Values => {
                self.api
                    .login_team(
                        &format!("team-{}", team.0),
                        "passwords-service",
                        &jwt,
                        Some(&audit_id),
                    )
                    .await
            }
            NamespaceAccess::Lifecycle => {
                self.api
                    .login_lifecycle(&format!("team-{}", team.0), &jwt, Some(&audit_id))
                    .await
            }
        }
        .map_err(provider_error)
    }
}

fn audit_id() -> String {
    tracing::Span::current()
        .context()
        .span()
        .span_context()
        .trace_id()
        .to_string()
}

// Keep transport causes in the typed client. Domain failures remain sanitized;
// provider authentication failure is an installation failure, not human denial.
fn provider_error(error: openbao_client::Error) -> Error {
    tracing::warn!(cause = ?error.cause(), status = error.status().map(i64::from), "OpenBao operation failed");
    match error.cause() {
        Cause::CasMismatch => Error::Conflict,
        Cause::InvalidInput => Error::Invalid,
        _ => Error::Unavailable,
    }
}

#[async_trait]
impl SecretProvider for OpenBaoProvider {
    #[tracing::instrument(skip_all,err,name="passwords.openbao.purge_namespace",fields(team_id=%team.0,outcome=tracing::field::Empty))]
    async fn purge_namespace(&self, team: TeamId) -> Result<(), Error> {
        let session = self
            .authenticated_client(team, NamespaceAccess::Lifecycle)
            .await?;
        let path = format!("team-{}", team.0);
        let audit_id = audit_id();
        self.api
            .delete_namespace(&session, &path, Some(&audit_id))
            .await
            .map_err(provider_error)?;
        // Deletion is asynchronous. Only a successful authenticated GET 404
        // acknowledges erasure; timeouts and policy denial retain metadata.
        for attempt in 0u32..8 {
            if !self
                .api
                .namespace_exists(&session, &path, Some(&audit_id))
                .await
                .map_err(provider_error)?
            {
                tracing::Span::current().record("outcome", "namespace_purged");
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100 * 2u64.pow(attempt.min(3)))).await;
        }
        Err(Error::Busy)
    }

    #[tracing::instrument(skip_all,err,name="passwords.openbao.current_version",fields(team_id=%team.0,item_id=%item.0))]
    async fn current_version(&self, team: TeamId, item: ItemId) -> Result<Option<i32>, Error> {
        let path = item.0.to_string();
        let path = path.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        self.with_session(team, |session| async move {
            match self.api.metadata(&session, path, Some(audit_id)).await {
                Ok(metadata) => Ok(Some(
                    i32::try_from(metadata.current_version).map_err(|_| Error::Unavailable)?,
                )),
                Err(error) if error.cause() == Cause::NotFound => Ok(None),
                Err(error) => Err(error.into()),
            }
        })
        .await
    }

    #[tracing::instrument(skip_all,err,name="passwords.openbao.status",fields(team_id=%team.0,item_id=%item.0))]
    async fn status(&self, team: TeamId, item: ItemId) -> Result<Option<(i32, uuid::Uuid)>, Error> {
        let path = item.0.to_string();
        let path = path.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        self.with_session(team, |session| async move {
            let metadata = match self.api.metadata(&session, path, Some(audit_id)).await {
                Ok(metadata) => metadata,
                Err(error) if error.cause() == Cause::NotFound => return Ok(None),
                Err(error) => return Err(error.into()),
            };
            // Pin the operation ID to the observed fence: an independent provider
            // writer must not pair a newer operation with the previous version.
            let stored: StoredSecret = self
                .api
                .read(
                    &session,
                    path,
                    Some(metadata.current_version),
                    Some(audit_id),
                )
                .await?;
            Ok(Some((
                i32::try_from(metadata.current_version).map_err(|_| Error::Unavailable)?,
                stored.operation_id,
            )))
        })
        .await
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
        let cas = u64::try_from(expected_version).map_err(|_| Error::Invalid)?;
        let path = item.0.to_string();
        let path = path.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        let stored = StoredSecret {
            operation_id: operation,
            values: values.clone(),
        };
        let stored = &stored;
        let version = self
            .with_session(team, |session| async move {
                Ok(self
                    .api
                    .write(&session, path, cas, stored, Some(audit_id))
                    .await?)
            })
            .await?;
        i32::try_from(version).map_err(|_| Error::Unavailable)
    }

    #[tracing::instrument(skip_all, err, name = "passwords.openbao.read")]
    async fn read(&self, team: TeamId, item: ItemId, version: i32) -> Result<SecretValues, Error> {
        let version = u64::try_from(version).map_err(|_| Error::Invalid)?;
        let path = item.0.to_string();
        let path = path.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        let stored: StoredSecret = self
            .with_session(team, |session| async move {
                Ok(self
                    .api
                    .read(&session, path, Some(version), Some(audit_id))
                    .await?)
            })
            .await?;
        Ok(stored.values)
    }

    #[tracing::instrument(skip_all,err,name="passwords.openbao.username",fields(team_id=%team.0,item_id=%item.0))]
    async fn username(
        &self,
        team: TeamId,
        item: ItemId,
        version: i32,
    ) -> Result<SecretString, Error> {
        #[derive(Deserialize)]
        struct StoredUsername {
            values: UsernameValue,
        }
        #[derive(Deserialize)]
        struct UsernameValue {
            username: SecretString,
        }
        let version = u64::try_from(version).map_err(|_| Error::Invalid)?;
        let path = item.0.to_string();
        let path = path.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        let stored: StoredUsername = self
            .with_session(team, |session| async move {
                Ok(self
                    .api
                    .read(&session, path, Some(version), Some(audit_id))
                    .await?)
            })
            .await?;
        Ok(stored.values.username)
    }

    #[tracing::instrument(skip_all,err,name="passwords.openbao.delete",fields(team_id=%team.0,item_id=%item.0))]
    async fn delete(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
        let path = item.0.to_string();
        let path = path.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        self.with_session(team, |session| async move {
            // Advance CAS before erasing, preserving metadata so delayed pre-delete
            // writes cannot recreate credentials. Retry only a confirmed CAS race.
            for _ in 0..3 {
                let metadata = match self.api.metadata(&session, path, Some(audit_id)).await {
                    Ok(metadata) => Some(metadata),
                    Err(error) if error.cause() == Cause::NotFound => None,
                    Err(error) => return Err(error.into()),
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
                let cas = metadata
                    .as_ref()
                    .map(|metadata| metadata.current_version)
                    .unwrap_or(0);
                match self
                    .api
                    .write(&session, path, cas, &tombstone, Some(audit_id))
                    .await
                {
                    Ok(version) => {
                        let mut versions = Vec::new();
                        if let Some(metadata) = metadata {
                            for version in metadata.versions.keys() {
                                versions
                                    .push(version.parse::<u64>().map_err(|_| Error::Unavailable)?);
                            }
                        }
                        versions.push(version);
                        return Ok(self
                            .api
                            .destroy_versions(&session, path, versions, Some(audit_id))
                            .await?);
                    }
                    Err(error) if error.cause() == Cause::CasMismatch => continue,
                    Err(error) => return Err(error.into()),
                }
            }
            Err(Error::Conflict.into())
        })
        .await
    }

    #[tracing::instrument(skip_all,err,name="passwords.openbao.history",fields(team_id=%team.0,item_id=%item.0))]
    async fn history(&self, team: TeamId, item: ItemId) -> Result<Vec<Version>, Error> {
        let path = item.0.to_string();
        let path = path.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        let metadata = self
            .with_session(team, |session| async move {
                Ok(self.api.metadata(&session, path, Some(audit_id)).await?)
            })
            .await?;
        let mut versions = Vec::new();
        for (version, metadata) in metadata.versions {
            if metadata.destroyed || !metadata.deletion_time.is_empty() {
                continue;
            }
            versions.push(Version {
                version: version.parse().map_err(|_| Error::Unavailable)?,
                created_at: metadata.created_time.to_rfc3339(),
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
        let name = key_id.0.to_string();
        let name = name.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        let key = openbao_client::SecretString::new(key.0.clone());
        let key = &key;
        self.with_session(team, |session| async move {
            Ok(self
                .api
                .write_totp(&session, name, key, Some(audit_id))
                .await?)
        })
        .await
    }

    #[tracing::instrument(skip_all,err,name="passwords.openbao.delete_totp",fields(team_id=%team.0,key_id=%key_id.0))]
    async fn delete_totp(&self, team: TeamId, key_id: TotpKeyId) -> Result<(), Error> {
        let name = key_id.0.to_string();
        let name = name.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        self.with_session(team, |session| async move {
            Ok(self.api.delete_totp(&session, name, Some(audit_id)).await?)
        })
        .await
    }

    #[tracing::instrument(skip_all,err,name="passwords.openbao.totp",fields(team_id=%team.0,key_id=%key_id.0))]
    async fn totp(&self, team: TeamId, key_id: TotpKeyId) -> Result<TotpCode, Error> {
        let name = key_id.0.to_string();
        let name = name.as_str();
        let audit_id = audit_id();
        let audit_id = audit_id.as_str();
        let code = self
            .with_session(team, |session| async move {
                Ok(self.api.totp(&session, name, Some(audit_id)).await?)
            })
            .await?;
        Ok(TotpCode {
            code: SecretString(code.expose().into()),
            period: 30,
        })
    }
}

/// Explicit unavailable state for installations that have not provisioned a vault.
pub struct UnavailableProvider;
#[async_trait]
impl SecretProvider for UnavailableProvider {
    async fn purge_namespace(&self, _: TeamId) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
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
    async fn username(&self, _: TeamId, _: ItemId, _: i32) -> Result<SecretString, Error> {
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
