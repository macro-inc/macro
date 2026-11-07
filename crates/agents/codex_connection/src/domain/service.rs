//! Owner policy and device-flow orchestration over encrypted repository and OAuth ports.

use super::*;
use codex_cloud_agents::domain::{DeviceLogin, LoginPoll, OAuth};
use std::{sync::Arc, time::Duration};

/// Connection lifecycle implementation; only the composition root chooses adapters.
pub struct ConnectionServiceImpl<P> {
    repository: Arc<dyn ConnectionRepository>,
    provider: P,
}
impl<P: OAuth> ConnectionServiceImpl<P> {
    /// Compose a durable encrypted repository and the provider's OAuth implementation.
    pub fn new(repository: Arc<dyn ConnectionRepository>, provider: P) -> Self {
        Self {
            repository,
            provider,
        }
    }
    async fn lock(&self, owner: &str) -> Result<Box<dyn ConnectionTransaction>, ConnectionError> {
        macro_user_id::user_id::MacroUserIdStr::parse_from_str(owner)
            .map_err(|_| ConnectionError::InvalidInput)?;
        self.repository.lock(owner).await
    }
    async fn fresh(&self, owner: &str) -> Result<StoredConnection, ConnectionError> {
        let mut transaction = self.lock(owner).await?;
        let connection = transaction
            .state()
            .connection
            .as_mut()
            .ok_or(ConnectionError::NotConnected)?;
        connection
            .credentials
            .validate()
            .map_err(|_| ConnectionError::Encryption)?;
        let now = Utc::now().timestamp().max(0) as u64;
        let needs_refresh = connection.credentials.expires_at <= now.saturating_add(60);
        if needs_refresh {
            let refreshed = self
                .provider
                .refresh(&connection.credentials)
                .await
                .map_err(|_| ConnectionError::Provider)?;
            refreshed
                .validate()
                .map_err(|_| ConnectionError::Provider)?;
            if refreshed.account_id != connection.credentials.account_id {
                return Err(ConnectionError::AccountChanged);
            }
            connection.credentials = refreshed;
        }
        let result = StoredConnection {
            id: connection.id,
            credentials: copy_credentials(&connection.credentials)?,
            environment_id: connection.environment_id.clone(),
        };
        // Persist any rotated token before a downstream provider operation can fail.
        if needs_refresh {
            transaction.commit().await?;
        }
        Ok(result)
    }
}
fn copy_credentials(credentials: &Credentials) -> Result<Credentials, ConnectionError> {
    Ok(Credentials {
        version: credentials.version,
        access_token: Secret::new(credentials.access_token.expose().to_owned())
            .map_err(|_| ConnectionError::Encryption)?,
        refresh_token: Secret::new(credentials.refresh_token.expose().to_owned())
            .map_err(|_| ConnectionError::Encryption)?,
        expires_at: credentials.expires_at,
        account_id: credentials.account_id.clone(),
    })
}
fn status(state: &ConnectionState) -> ConnectionStatus {
    ConnectionStatus {
        connected: state.connection.is_some(),
        account_id: state
            .connection
            .as_ref()
            .map(|connection| connection.credentials.account_id.clone()),
        environment_id: state
            .connection
            .as_ref()
            .and_then(|connection| connection.environment_id.clone()),
    }
}

#[async_trait]
impl<P: OAuth + 'static> ConnectionService for ConnectionServiceImpl<P> {
    async fn status(&self, owner: &str) -> Result<ConnectionStatus, ConnectionError> {
        let mut transaction = self.lock(owner).await?;
        Ok(status(transaction.state()))
    }
    async fn start_login(&self, owner: &str) -> Result<StartedLogin, ConnectionError> {
        let mut transaction = self.lock(owner).await?;
        if transaction.state().connection.is_some() {
            return Err(ConnectionError::AlreadyConnected);
        }
        let login = self
            .provider
            .begin()
            .await
            .map_err(|_| ConnectionError::Provider)?;
        let now = Utc::now();
        let expires_at = now + chrono::Duration::seconds(login.timeout.as_secs().min(900) as i64);
        let interval_seconds = login.interval.as_secs().clamp(1, 900);
        let id = Uuid::now_v7();
        let result = StartedLogin {
            attempt_id: id,
            verification_url: login.verification_url.clone(),
            user_code: login.user_code.clone(),
            expires_at,
            poll_interval_seconds: interval_seconds,
        };
        transaction.state().attempt = Some(LoginAttempt {
            id,
            status: LoginStatus::Pending,
            expires_at,
            next_poll_at: now + chrono::Duration::seconds(interval_seconds as i64),
            interval_seconds,
            device: Some(DeviceState {
                device_auth_id: login.device_auth_id,
                user_code: login.user_code,
                verification_url: login.verification_url,
            }),
        });
        transaction.commit().await?;
        Ok(result)
    }
    async fn poll_login(&self, owner: &str, id: Uuid) -> Result<LoginStatus, ConnectionError> {
        let mut transaction = self.lock(owner).await?;
        let attempt = transaction
            .state()
            .attempt
            .as_mut()
            .filter(|attempt| attempt.id == id)
            .ok_or(ConnectionError::NotFound)?;
        if attempt.status != LoginStatus::Pending {
            return Ok(attempt.status);
        }
        let now = Utc::now();
        if now >= attempt.expires_at {
            attempt.status = LoginStatus::Expired;
            attempt.device = None;
            transaction.commit().await?;
            return Ok(LoginStatus::Expired);
        }
        if now < attempt.next_poll_at {
            return Ok(LoginStatus::Pending);
        }
        let device = attempt.device.as_ref().ok_or(ConnectionError::Encryption)?;
        let login = DeviceLogin {
            device_auth_id: Secret::new(device.device_auth_id.expose().to_owned())
                .map_err(|_| ConnectionError::Encryption)?,
            user_code: device.user_code.clone(),
            verification_url: device.verification_url.clone(),
            interval: Duration::from_secs(attempt.interval_seconds),
            timeout: Duration::from_secs((attempt.expires_at - now).num_seconds().max(0) as u64),
        };
        let polled = self.provider.poll(&login).await;
        if Utc::now() >= attempt.expires_at {
            attempt.status = LoginStatus::Expired;
            attempt.device = None;
            transaction.commit().await?;
            return Ok(LoginStatus::Expired);
        }
        // The lock remains held across exchange and persistence, preventing a second replica
        // from exchanging this attempt or replacing its credentials concurrently.
        let outcome = match polled {
            Ok(LoginPoll::Pending) => {
                attempt.next_poll_at =
                    Utc::now() + chrono::Duration::seconds(attempt.interval_seconds as i64);
                LoginStatus::Pending
            }
            Ok(LoginPoll::Complete(credentials)) => {
                if credentials.validate().is_err() {
                    attempt.status = LoginStatus::Failed;
                    attempt.device = None;
                    LoginStatus::Failed
                } else {
                    attempt.status = LoginStatus::Connected;
                    attempt.device = None;
                    transaction.state().connection = Some(StoredConnection {
                        id: Uuid::now_v7(),
                        credentials,
                        environment_id: None,
                    });
                    LoginStatus::Connected
                }
            }
            Err(_) => {
                attempt.status = LoginStatus::Failed;
                attempt.device = None;
                LoginStatus::Failed
            }
        };
        transaction.commit().await?;
        Ok(outcome)
    }
    async fn cancel_login(&self, owner: &str, id: Uuid) -> Result<(), ConnectionError> {
        let mut transaction = self.lock(owner).await?;
        let attempt = transaction
            .state()
            .attempt
            .as_ref()
            .filter(|attempt| attempt.id == id)
            .ok_or(ConnectionError::NotFound)?;
        // Cancelling an already completed login must not disconnect its credentials.
        if attempt.status == LoginStatus::Pending {
            transaction.state().attempt = None;
            transaction.commit().await?;
        }
        Ok(())
    }
    async fn disconnect(&self, owner: &str) -> Result<(), ConnectionError> {
        let mut transaction = self.lock(owner).await?;
        *transaction.state() = ConnectionState::default();
        transaction.commit().await
    }
    async fn environments(&self, owner: &str) -> Result<Vec<Environment>, ConnectionError> {
        let connection = self.fresh(owner).await?;
        self.provider
            .environments(&connection.credentials)
            .await
            .map_err(|_| ConnectionError::Provider)
    }
    async fn configure(
        &self,
        owner: &str,
        environment: &str,
    ) -> Result<ConnectionStatus, ConnectionError> {
        CloudId::new(environment.to_owned()).map_err(|_| ConnectionError::InvalidInput)?;
        let resolved = self.fresh(owner).await?;
        let environments = self
            .provider
            .environments(&resolved.credentials)
            .await
            .map_err(|_| ConnectionError::Provider)?;
        if !environments.iter().any(|item| item.id == environment) {
            return Err(ConnectionError::InvalidInput);
        }
        let mut transaction = self.lock(owner).await?;
        let connection = transaction
            .state()
            .connection
            .as_mut()
            .ok_or(ConnectionError::NotConnected)?;
        if connection.id != resolved.id {
            return Err(ConnectionError::AccountChanged);
        }
        connection.environment_id = Some(environment.to_owned());
        let result = status(transaction.state());
        transaction.commit().await?;
        Ok(result)
    }
    async fn resolve(&self, owner: &str) -> Result<ResolvedConnection, ConnectionError> {
        let connection = self.fresh(owner).await?;
        Ok(ResolvedConnection {
            connection_id: connection.id,
            credentials: connection.credentials,
            environment_id: connection
                .environment_id
                .map(CloudId::new)
                .transpose()
                .map_err(|_| ConnectionError::Encryption)?,
        })
    }
}

#[cfg(test)]
mod test;
