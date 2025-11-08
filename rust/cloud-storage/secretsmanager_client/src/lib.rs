#[cfg(test)]
pub use MockSecretsManagerClient as SecretsManager;
#[cfg(not(test))]
pub use SecretsManagerClient as SecretsManager;
use aws_sdk_secretsmanager as secretsmanager;
#[allow(unused_imports)]
use mockall::automock;
pub use remote_env_var::{LocalOrRemoteSecret, SecretManager};
use std::sync::Arc;
use thiserror::Error;

#[derive(Clone, Debug)]
pub struct SecretsManagerClient {
    inner: secretsmanager::Client,
}

#[derive(Debug, Error)]
pub enum SecretErr {
    #[error("{0:?}")]
    AwsErr(#[from] aws_sdk_secretsmanager::Error),
    #[error("The secret did not exist in aws")]
    NotPresent,
}

#[cfg_attr(test, automock)]
impl SecretsManagerClient {
    pub fn new(inner: secretsmanager::Client) -> Self {
        Self { inner }
    }
}

impl SecretManager for SecretsManagerClient {
    type Err = SecretErr;

    #[tracing::instrument(err, skip(self, var), fields(self = %std::any::type_name_of_val(self), var = %std::any::type_name_of_val(&var)))]
    async fn get_secret_value<T: AsRef<str> + Send>(&self, var: T) -> Result<Arc<str>, SecretErr> {
        let result = self
            .inner
            .get_secret_value()
            .secret_id(var.as_ref())
            .send()
            .await
            .map_err(aws_sdk_secretsmanager::Error::from)?;

        if let Some(secret_string) = result.secret_string() {
            return Ok(Arc::from(secret_string));
        }

        Err(SecretErr::NotPresent)
    }
}
