//! Atomic cross-replica controller claims with bounded expiry and retry tombstones.

use crate::domain::{
    model::{LeaseState, MAX_DURATION_SECONDS, Result, VoiceError, VoiceLease, VoiceSessionId},
    ports::VoiceLeaseStore,
};
use async_trait::async_trait;
use macro_uuid::Uuid;
use std::time::Duration;

const RETENTION_SECONDS: u32 = MAX_DURATION_SECONDS + 300;
const STORE_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(test)]
mod test;

/// Shared Redis storage; no process-local claim can admit a competing controller.
pub struct RedisVoiceLeaseStore {
    client: redis::Client,
}

impl RedisVoiceLeaseStore {
    /// Reuse the harness service's existing Redis client.
    pub fn new(client: redis::Client) -> Self {
        Self { client }
    }

    async fn connection(&self) -> Result<redis::aio::MultiplexedConnection> {
        let config = redis::AsyncConnectionConfig::new()
            .set_connection_timeout(Some(STORE_TIMEOUT))
            .set_response_timeout(Some(STORE_TIMEOUT));
        self.client
            .get_multiplexed_async_connection_with_config(&config)
            .await
            .map_err(failure)
    }
}

fn lease_key(session: Uuid) -> String {
    format!("agent-voice:{{{session}}}:lease")
}
fn ended_key(session: Uuid, client: Uuid) -> String {
    format!("agent-voice:{{{session}}}:ended:{client}")
}
fn failure(error: impl std::error::Error + Send + Sync + 'static) -> VoiceError {
    VoiceError::Infrastructure(rootcause::report!(error).into())
}

#[async_trait]
impl VoiceLeaseStore for RedisVoiceLeaseStore {
    async fn claim(&self, lease: &VoiceLease) -> Result<Option<VoiceLease>> {
        let mut connection = self.connection().await?;
        let encoded = serde_json::to_string(lease).map_err(failure)?;
        let previous: Option<String> = redis::Script::new(include_str!("redis/claim.lua"))
            .key(lease_key(lease.session_id))
            .key(ended_key(lease.session_id, lease.client_session_id))
            .arg(encoded)
            .arg(RETENTION_SECONDS)
            .invoke_async(&mut connection)
            .await
            .map_err(failure)?;
        previous
            .map(|value| serde_json::from_str(&value).map_err(failure))
            .transpose()
    }

    async fn get(&self, session: Uuid) -> Result<Option<VoiceLease>> {
        let mut connection = self.connection().await?;
        let value: Option<String> = redis::cmd("GET")
            .arg(lease_key(session))
            .query_async(&mut connection)
            .await
            .map_err(failure)?;
        value
            .map(|value| serde_json::from_str(&value).map_err(failure))
            .transpose()
    }

    async fn transition(
        &self,
        session: Uuid,
        voice: VoiceSessionId,
        from: LeaseState,
        to: LeaseState,
    ) -> Result<bool> {
        let mut connection = self.connection().await?;
        let from = serde_json::to_value(from).map_err(failure)?;
        let to = serde_json::to_value(to).map_err(failure)?;
        redis::Script::new(include_str!("redis/transition.lua"))
            .key(lease_key(session))
            .arg(voice.0.to_string())
            .arg(from.as_str().unwrap_or_default())
            .arg(to.as_str().unwrap_or_default())
            .invoke_async(&mut connection)
            .await
            .map_err(failure)
    }

    async fn release(&self, session: Uuid, voice: VoiceSessionId) -> Result<()> {
        let Some(lease) = self.get(session).await? else {
            return Ok(());
        };
        let mut connection = self.connection().await?;
        let _: bool = redis::Script::new(include_str!("redis/release.lua"))
            .key(lease_key(session))
            .key(ended_key(session, lease.client_session_id))
            .arg(voice.0.to_string())
            .arg(RETENTION_SECONDS)
            .invoke_async(&mut connection)
            .await
            .map_err(failure)?;
        Ok(())
    }
}
