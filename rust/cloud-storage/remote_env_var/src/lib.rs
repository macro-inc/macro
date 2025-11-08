#![deny(missing_docs)]
//! This crate is a low level interface for declaring secret env vars which might be defined locally,
//! or alternatively might be defined inside of a remote secret manager.
use std::sync::Arc;

use macro_env::Environment;
use thiserror::Error;

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
}
