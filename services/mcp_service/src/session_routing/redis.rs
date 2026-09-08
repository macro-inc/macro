//! Redis directory and process liveness. No pending tool calls are persisted or replayed.
use super::directory::{Directory, Owner};
use redis::AsyncCommands;
use std::{net::SocketAddr, time::Duration};

macro_env_var::maybe_env_vars! {
    /// Explicit private listen address for standalone replicas (IP:port).
    pub struct McpReplicaAddress;
    /// ECS-provided metadata endpoint for this container.
    pub struct EcsContainerMetadataUriV4;
}

const SESSION_TTL: u64 = 7200;
const PROCESS_TTL: u64 = 60;

#[derive(Clone)]
pub(crate) struct RedisDirectory {
    client: redis::Client,
    prefix: String,
}

impl RedisDirectory {
    pub(crate) fn new(url: &str, namespace: &str) -> Result<Self, redis::RedisError> {
        Ok(Self {
            client: redis::Client::open(url)?,
            prefix: format!("mcp:sessions:{namespace}"),
        })
    }

    async fn connection(&self) -> Result<redis::aio::MultiplexedConnection, String> {
        self.client
            .get_multiplexed_async_connection_with_config(
                &redis::AsyncConnectionConfig::new()
                    .set_connection_timeout(Some(Duration::from_secs(5)))
                    .set_response_timeout(Some(Duration::from_secs(5))),
            )
            .await
            .map_err(|e| e.to_string())
    }

    pub(crate) async fn retire(&self, process: &str) -> Result<(), String> {
        let mut conn = self.connection().await?;
        conn.set_ex::<_, _, ()>(
            format!("{}:process:{process}", self.prefix),
            "retired",
            SESSION_TTL,
        )
        .await
        .map_err(|e| e.to_string())
    }

    pub(crate) async fn heartbeat(&self, process: &str) -> Result<(), String> {
        let mut conn = self.connection().await?;
        // A delayed heartbeat must not resurrect a process after retirement.
        let refreshed: bool = redis::Script::new(
            "if redis.call('GET', KEYS[1]) == 'retired' then return 0 end \
             redis.call('SET', KEYS[1], 'alive', 'EX', ARGV[1]); return 1",
        )
        .key(format!("{}:process:{process}", self.prefix))
        .arg(PROCESS_TTL)
        .invoke_async(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
        if refreshed {
            Ok(())
        } else {
            Err("MCP replica was retired".into())
        }
    }
}

#[async_trait::async_trait]
impl Directory for RedisDirectory {
    async fn lookup(&self, session: &str) -> Result<Option<Owner>, String> {
        let mut conn = self.connection().await?;
        let key = format!("{}:session:{session}", self.prefix);
        let value: Option<String> = conn.get(&key).await.map_err(|e| e.to_string())?;
        let Some(value) = value else {
            return Ok(None);
        };
        let owner: Owner = serde_json::from_str(&value).map_err(|e| e.to_string())?;
        let alive: Option<String> = conn
            .get(format!("{}:process:{}", self.prefix, owner.process))
            .await
            .map_err(|e| e.to_string())?;
        if alive.as_deref() != Some("alive") {
            return Ok(None);
        }
        let _: bool = conn
            .expire(key, SESSION_TTL as i64)
            .await
            .map_err(|e| e.to_string())?;
        Ok(Some(owner))
    }

    async fn register(&self, session: &str, owner: &Owner) -> Result<(), String> {
        let mut conn = self.connection().await?;
        let value = serde_json::to_string(owner).map_err(|e| e.to_string())?;
        conn.set_ex::<_, _, ()>(
            format!("{}:session:{session}", self.prefix),
            value,
            SESSION_TTL,
        )
        .await
        .map_err(|e| e.to_string())
    }

    async fn remove(&self, session: &str) -> Result<(), String> {
        let mut conn = self.connection().await?;
        conn.del::<_, ()>(format!("{}:session:{session}", self.prefix))
            .await
            .map_err(|e| e.to_string())
    }
}

/// ECS supplies the private task IP. Local probes may override it without DNS
/// or a public load balancer becoming a forwarding destination.
pub(crate) async fn replica_address(port: usize) -> Result<SocketAddr, String> {
    if let Some(address) = McpReplicaAddress::new().as_ref() {
        return address.parse::<SocketAddr>().map_err(|e| e.to_string());
    }
    if let Some(metadata) = EcsContainerMetadataUriV4::new().as_ref() {
        let value: serde_json::Value = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?
            .get(metadata.as_ref())
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let ip = value["Networks"]
            .as_array()
            .and_then(|networks| {
                networks
                    .iter()
                    .find_map(|network| network["IPv4Addresses"][0].as_str())
            })
            .ok_or("ECS metadata has no private IPv4 address")?;
        return format!("{ip}:{port}")
            .parse::<SocketAddr>()
            .map_err(|e| e.to_string());
    }
    format!("127.0.0.1:{port}")
        .parse::<SocketAddr>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod test;
