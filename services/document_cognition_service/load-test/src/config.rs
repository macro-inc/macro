use anyhow::{Context, Result};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::time::Duration;

fn duration_ms_serialize<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_u64(duration.as_millis() as u64)
}

fn duration_ms_deserialize<'de, D>(deserializer: D) -> Result<Duration, D::Error>
where
    D: Deserializer<'de>,
{
    let millis = u64::deserialize(deserializer)?;
    Ok(Duration::from_secs(millis))
}

fn duration_s_serialize<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_u64(duration.as_millis() as u64)
}

fn duration_s_deserialize<'de, D>(deserializer: D) -> Result<Duration, D::Error>
where
    D: Deserializer<'de>,
{
    let millis = u64::deserialize(deserializer)?;
    Ok(Duration::from_secs(millis))
}

#[derive(Deserialize, Serialize)]
pub struct Config {
    /// number of connections(users)
    pub num_connections: usize,
    /// number of messages to be sent for each individual connection
    pub request_per_connection: usize,
    /// base url for both the api and ws
    pub base_url: String,
    #[serde(default)]
    #[serde(
        serialize_with = "duration_s_serialize",
        deserialize_with = "duration_s_deserialize"
    )]
    /// the max time a websocket connection should remain open in seconds
    pub connection_timeout: Duration,
    #[serde(
        serialize_with = "duration_s_serialize",
        deserialize_with = "duration_s_deserialize"
    )]
    #[serde(default)]
    /// the duration of the ramp up to max load
    pub ramp_up_duration: Duration,
    #[serde(default)]
    #[serde(
        serialize_with = "duration_ms_serialize",
        deserialize_with = "duration_ms_deserialize"
    )]
    /// the delay in miliseconds between each new
    /// client websocket connection
    pub delay_between_connections: Duration,
}

pub fn read(path: &str) -> Result<Config> {
    let content = std::fs::read_to_string(path).context(format!("failed to read {}", path))?;
    let config: Config =
        serde_json::from_str::<Config>(&content).context("failed to parse config file")?;

    Ok(config)
}
