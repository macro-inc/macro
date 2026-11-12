use crate::{
    Cause, Error, SecretString,
    error::Operation,
    generated::{self, types},
    secret::SecretData,
};
use serde::{Serialize, de::DeserializeOwned};
use std::{collections::BTreeMap, time::Duration};

/// Metadata for a KV version; no credential payload is included.
#[derive(Clone, Debug)]
pub struct KvVersion {
    /// Creation timestamp supplied by OpenBao.
    pub created_time: chrono::DateTime<chrono::Utc>,
    /// Empty for a live version; otherwise its deletion timestamp.
    pub deletion_time: String,
    /// Whether the version has been permanently destroyed.
    pub destroyed: bool,
}

/// KV version inventory, including destroyed versions needed for exact cleanup.
#[derive(Clone, Debug)]
pub struct KvMetadata {
    /// CAS fence, including deleted or destroyed current versions.
    pub current_version: u64,
    /// Exact version inventory from the metadata response.
    pub versions: BTreeMap<String, KvVersion>,
}

/// Short-lived authenticated session, scoped by its login operation.
#[derive(Clone, Debug)]
pub struct Session {
    token: SecretString,
    namespace: Option<String>,
}

/// Thin typed client for fixed mounted OpenBao endpoints.
/// No default environment credentials, automatic redirects or transport retries.
#[derive(Clone)]
pub struct OpenBaoClient {
    api: generated::Client,
}

impl progenitor_client::ClientHooks for generated::Client {
    async fn pre<E>(
        &self,
        request: &mut reqwest::Request,
        _: &progenitor_client::OperationInfo,
    ) -> Result<(), progenitor_client::Error<E>> {
        macro_tower_layers::inject_trace_headers(request.headers_mut());
        Ok(())
    }
}

impl OpenBaoClient {
    /// Build one shared transport with explicit request/connect bounds.
    pub fn new(address: &str) -> Result<Self, Error> {
        let url = reqwest::Url::parse(address).map_err(|_| Error::local(Cause::InvalidInput))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || !matches!(url.path(), "" | "/")
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(Error::local(Cause::InvalidInput));
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .map_err(|_| Error::local(Cause::Transport))?;
        Ok(Self {
            api: generated::Client::new_with_client(address.trim_end_matches('/'), http),
        })
    }

    /// Log in through the namespace's `macro` JWT mount.
    #[tracing::instrument(skip_all, err, name = "openbao.login_team")]
    pub async fn login_team(
        &self,
        namespace: &str,
        role: &str,
        jwt: &SecretString,
        audit_id: Option<&str>,
    ) -> Result<Session, Error> {
        let body = types::LoginRequest {
            jwt: jwt.clone(),
            role: role.into(),
        };
        let response = self
            .api
            .login_team(namespace, None, audit_id, &body)
            .await
            .map_err(|error| Error::generated(error, Operation::Login))?;
        Ok(Session {
            token: response.into_inner().auth.client_token,
            namespace: Some(namespace.into()),
        })
    }

    /// Log in through the parent's `macro-lifecycle` JWT mount.
    #[tracing::instrument(skip_all, err, name = "openbao.login_lifecycle")]
    pub async fn login_lifecycle(
        &self,
        role: &str,
        jwt: &SecretString,
        audit_id: Option<&str>,
    ) -> Result<Session, Error> {
        let body = types::LoginRequest {
            jwt: jwt.clone(),
            role: role.into(),
        };
        let response = self
            .api
            .login_lifecycle(None, audit_id, &body)
            .await
            .map_err(|error| Error::generated(error, Operation::Login))?;
        Ok(Session {
            token: response.into_inner().auth.client_token,
            namespace: None,
        })
    }

    /// Read metadata without decrypting credential values.
    #[tracing::instrument(skip_all, err, name = "openbao.metadata")]
    pub async fn metadata(
        &self,
        session: &Session,
        path: &str,
        audit_id: Option<&str>,
    ) -> Result<KvMetadata, Error> {
        let response = self
            .api
            .read_metadata(path, session.namespace()?, session.token.expose(), audit_id)
            .await
            .map_err(|error| Error::generated(error, Operation::Other))?;
        let data = response.into_inner().data;
        Ok(KvMetadata {
            current_version: data.current_version,
            versions: data
                .versions
                .into_iter()
                .map(|(version, data)| {
                    (
                        version,
                        KvVersion {
                            created_time: data.created_time,
                            deletion_time: data.deletion_time,
                            destroyed: data.destroyed,
                        },
                    )
                })
                .collect(),
        })
    }

    /// Read exactly one version, or the current value when no version is supplied.
    #[tracing::instrument(skip_all, err, name = "openbao.read")]
    pub async fn read<T: DeserializeOwned>(
        &self,
        session: &Session,
        path: &str,
        version: Option<u64>,
        audit_id: Option<&str>,
    ) -> Result<T, Error> {
        let response = self
            .api
            .read_secret(
                path,
                version,
                session.namespace()?,
                session.token.expose(),
                audit_id,
            )
            .await
            .map_err(|error| Error::generated(error, Operation::Other))?;
        let data = response.into_inner().data.data;
        serde_json::from_value(serde_json::Value::Object(data.0.clone()))
            .map_err(|_| Error::local(Cause::InvalidResponse))
    }

    /// Write with an explicit CAS fence; no automatic retry on uncertain acceptance.
    #[tracing::instrument(skip_all, err, name = "openbao.write")]
    pub async fn write<T: Serialize>(
        &self,
        session: &Session,
        path: &str,
        cas: u64,
        value: &T,
        audit_id: Option<&str>,
    ) -> Result<u64, Error> {
        let serde_json::Value::Object(data) =
            serde_json::to_value(value).map_err(|_| Error::local(Cause::InvalidInput))?
        else {
            return Err(Error::local(Cause::InvalidInput));
        };
        let body = types::WriteSecretRequest {
            data: SecretData(data),
            options: types::CasOptions { cas },
        };
        let response = self
            .api
            .write_secret(
                path,
                session.namespace()?,
                session.token.expose(),
                audit_id,
                &body,
            )
            .await
            .map_err(|error| Error::generated(error, Operation::Cas))?;
        Ok(response.into_inner().data.version)
    }

    /// Destroy only the exact versions supplied; preserve metadata and its CAS fence.
    #[tracing::instrument(skip_all, err, name = "openbao.destroy_versions")]
    pub async fn destroy_versions(
        &self,
        session: &Session,
        path: &str,
        versions: Vec<u64>,
        audit_id: Option<&str>,
    ) -> Result<(), Error> {
        self.api
            .destroy_versions(
                path,
                session.namespace()?,
                session.token.expose(),
                audit_id,
                &types::DestroyRequest { versions },
            )
            .await
            .map_err(|error| Error::generated(error, Operation::Other))?;
        Ok(())
    }

    /// Import a TOTP seed under an immutable enrollment identity.
    #[tracing::instrument(skip_all, err, name = "openbao.write_totp")]
    pub async fn write_totp(
        &self,
        session: &Session,
        name: &str,
        key: &SecretString,
        audit_id: Option<&str>,
    ) -> Result<(), Error> {
        let body = types::TotpWriteRequest {
            key: key.clone(),
            algorithm: "SHA1".into(),
            period: 30,
            digits: 6,
        };
        self.api
            .write_totp(
                name,
                session.namespace()?,
                session.token.expose(),
                audit_id,
                &body,
            )
            .await
            .map_err(|error| Error::generated(error, Operation::Other))?;
        Ok(())
    }

    /// Erase one TOTP enrollment; a missing key is already erased.
    #[tracing::instrument(skip_all, err, name = "openbao.delete_totp")]
    pub async fn delete_totp(
        &self,
        session: &Session,
        name: &str,
        audit_id: Option<&str>,
    ) -> Result<(), Error> {
        match self
            .api
            .delete_totp(name, session.namespace()?, session.token.expose(), audit_id)
            .await
            .map_err(|error| Error::generated(error, Operation::Other))
        {
            Ok(_) => Ok(()),
            Err(error) if error.cause() == Cause::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Obtain a code without ever formatting it.
    #[tracing::instrument(skip_all, err, name = "openbao.read_totp")]
    pub async fn totp(
        &self,
        session: &Session,
        name: &str,
        audit_id: Option<&str>,
    ) -> Result<SecretString, Error> {
        let response = self
            .api
            .read_totp(name, session.namespace()?, session.token.expose(), audit_id)
            .await
            .map_err(|error| Error::generated(error, Operation::TotpCode(name)))?;
        Ok(response.into_inner().data.code)
    }

    /// Request asynchronous namespace deletion; only a later GET 404 proves absence.
    #[tracing::instrument(skip_all, err, name = "openbao.delete_namespace")]
    pub async fn delete_namespace(
        &self,
        session: &Session,
        path: &str,
        audit_id: Option<&str>,
    ) -> Result<(), Error> {
        session.require_parent()?;
        match self
            .api
            .delete_namespace(path, session.token.expose(), audit_id)
            .await
            .map_err(|error| Error::generated(error, Operation::Namespace))
        {
            Ok(_) => Ok(()),
            Err(error) if error.cause() == Cause::Namespace => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Check namespace presence with the parent token. Policy denial is never absence.
    #[tracing::instrument(skip_all, err, name = "openbao.namespace_exists")]
    pub async fn namespace_exists(
        &self,
        session: &Session,
        path: &str,
        audit_id: Option<&str>,
    ) -> Result<bool, Error> {
        session.require_parent()?;
        match self
            .api
            .read_namespace(path, session.token.expose(), audit_id)
            .await
            .map_err(|error| Error::generated(error, Operation::Namespace))
        {
            Ok(_) => Ok(true),
            Err(error) if error.cause() == Cause::Namespace => Ok(false),
            Err(error) => Err(error),
        }
    }
}

impl Session {
    fn namespace(&self) -> Result<&str, Error> {
        self.namespace
            .as_deref()
            .ok_or_else(|| Error::local(Cause::InvalidInput))
    }

    fn require_parent(&self) -> Result<(), Error> {
        if self.namespace.is_some() {
            return Err(Error::local(Cause::InvalidInput));
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
