use chrono::{DateTime, Utc, serde::ts_seconds};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use utoipa::ToSchema;

/// DateTime<Utc> ts_seconds deserialization + RFC3339 serialization
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct HumanReadableTimestamp(
    #[serde(deserialize_with = "ts_seconds::deserialize")] pub DateTime<Utc>,
);

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct TimestampSeconds(pub i64);

impl From<i64> for TimestampSeconds {
    fn from(inner: i64) -> Self {
        Self(inner)
    }
}

pub trait TimestampField: DeserializeOwned + Serialize {}

impl TimestampField for TimestampSeconds {}

impl TimestampField for HumanReadableTimestamp {}
