#![deny(missing_docs)]
//! This crate is a low level interface for declaring secret env vars which might be defined locally,
//! or alternatively might be defined inside of a remote secret manager.
use std::sync::Arc;

use macro_env::Environment;
use thiserror::Error;

#[cfg(test)]
mod test;

/// a trait to abstract away the expected interface for fetching a secret from a remote server
pub trait SecretManager: Send + Sync {
    /// The error that can be returned from the server
    type Err: std::error::Error;
    /// fetch the secret from the server
    fn get_secret_value<T: AsRef<str> + Send>(
        &self,
        secret_name: T,
    ) -> impl Future<Output = Result<Arc<str>, Self::Err>> + Send;

    /// if we are in local mode, return the env var T,
    /// if we are in dev or production read the secret with the name equal to the value of T
    #[tracing::instrument(err, skip(self, var), fields(self = %std::any::type_name_of_val(self), var = %std::any::type_name_of_val(&var)))]
    fn get_maybe_secret_value<T: AsRef<str> + Send>(
        &self,
        environment: Environment,
        var: T,
    ) -> impl Future<Output = Result<LocalOrRemoteSecret<T>, Self::Err>> + Send {
        async move {
            match environment {
                Environment::Local => Ok(LocalOrRemoteSecret::Local(var)),
                Environment::Production | Environment::Develop => Ok(LocalOrRemoteSecret::Remote(
                    self.get_secret_value(var).await?,
                )),
            }
        }
    }
}

/// the [SecretManager::Err] type for [NullSecretManager]
#[derive(Debug, Error)]
#[error("Not implemented")]
pub struct NotImplemented;

/// testing struct which implements [SecretManager]
/// this will always fail with [NotImplemented]
pub struct NullSecretManager;

impl SecretManager for NullSecretManager {
    type Err = NotImplemented;

    async fn get_secret_value<T: AsRef<str> + Send>(
        &self,
        _secret_name: T,
    ) -> Result<Arc<str>, Self::Err> {
        Err(NotImplemented)
    }
}

/// A secret that is either derived from the local environment or from something that implements [SecretManager]
#[derive(Clone)]
pub enum LocalOrRemoteSecret<T> {
    /// the secret is from the local env
    Local(T),
    /// the secret is from aws
    Remote(Arc<str>),
}

impl<T> AsRef<str> for LocalOrRemoteSecret<T>
where
    T: AsRef<str>,
{
    fn as_ref(&self) -> &str {
        match self {
            LocalOrRemoteSecret::Local(s) => s.as_ref(),
            LocalOrRemoteSecret::Remote(s) => s,
        }
    }
}

impl<'de, T> serde::Deserialize<'de> for LocalOrRemoteSecret<T>
where
    T: serde::Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        T::deserialize(deserializer).map(LocalOrRemoteSecret::Local)
    }
}

impl<T> LocalOrRemoteSecret<T>
where
    T: AsRef<str> + Send,
{
    /// Create a new value from a secret manager
    pub fn new_from_secret_manager<S>(
        val: T,
        secret_manager: &S,
    ) -> impl Future<Output = Result<Self, S::Err>>
    where
        S: SecretManager,
    {
        secret_manager.get_maybe_secret_value(Environment::new_or_prod(), val)
    }

    /// Resolve a locally deserialized secret through a secret manager for the provided environment.
    ///
    /// This is useful for values produced by Serde-based config loading: deserialization can only
    /// construct the local env-var wrapper, while remote secret lookup requires an async secret
    /// manager.
    pub async fn resolve_from_secret_manager<S>(
        self,
        environment: Environment,
        secret_manager: &S,
    ) -> Result<Self, S::Err>
    where
        S: SecretManager,
    {
        match self {
            LocalOrRemoteSecret::Local(var) => {
                secret_manager
                    .get_maybe_secret_value(environment, var)
                    .await
            }
            LocalOrRemoteSecret::Remote(secret) => Ok(LocalOrRemoteSecret::Remote(secret)),
        }
    }
}

/// Optional variant of [`LocalOrRemoteSecret`]. `None` represents an env var
/// that wasn't configured at all; `Some(...)` carries a resolved secret.
/// Useful for secrets that are genuinely optional (e.g. a read-replica URL
/// that, when absent, lets callers fall back to a different code path).
#[derive(Clone)]
pub struct OptionalLocalOrRemoteSecret<T>(pub Option<LocalOrRemoteSecret<T>>);

impl<'de, T> serde::Deserialize<'de> for OptionalLocalOrRemoteSecret<T>
where
    LocalOrRemoteSecret<T>: serde::Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Option::<LocalOrRemoteSecret<T>>::deserialize(deserializer).map(OptionalLocalOrRemoteSecret)
    }
}

impl<T> OptionalLocalOrRemoteSecret<T>
where
    T: AsRef<str> + Send,
{
    /// Resolve `val` through the secret manager when present, propagating
    /// the manager's error on failure. `None` in → `None` out, with no
    /// secret-manager call.
    pub async fn new_from_secret_manager<S>(
        val: Option<T>,
        secret_manager: &S,
    ) -> Result<Self, S::Err>
    where
        S: SecretManager,
    {
        match val {
            Some(v) => Ok(Self(Some(
                LocalOrRemoteSecret::new_from_secret_manager(v, secret_manager).await?,
            ))),
            None => Ok(Self(None)),
        }
    }

    /// Resolve a locally deserialized optional secret through a secret manager for the provided
    /// environment.
    pub async fn resolve_from_secret_manager<S>(
        self,
        environment: Environment,
        secret_manager: &S,
    ) -> Result<Self, S::Err>
    where
        S: SecretManager,
    {
        match self.0 {
            Some(secret) => Ok(Self(Some(
                secret
                    .resolve_from_secret_manager(environment, secret_manager)
                    .await?,
            ))),
            None => Ok(Self(None)),
        }
    }

    /// View the resolved secret as `&str`, or `None` when unset.
    pub fn as_str(&self) -> Option<&str>
    where
        T: AsRef<str>,
    {
        self.0.as_ref().map(AsRef::as_ref)
    }
}
