use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub enum DeleteError {
    NotFound(String),
    Other(String),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
/// The model stored in themetadat dynamodb table
pub struct MetadataObject {
    /// file_id (partition key)
    pub file_id: String,
    /// owner_id - uploading user
    pub owner_id: String,
    /// mime type
    pub content_type: String,
    /// is data uploaded to s3
    pub is_uploaded: bool,
    /// date of last get
    #[serde(with = "datetime_format")]
    pub last_accessed: DateTime<Utc>,
    /// any other goofy stuff you crazy kids want
    pub extension_data: Option<Value>,
    /// name of file
    pub file_name: String,
    /// s3 key
    pub s3_key: String,
}

mod datetime_format {
    use chrono::{DateTime, Utc};
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(date: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let s = date.to_rfc3339();
        serializer.serialize_str(&s)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<DateTime<Utc>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        DateTime::parse_from_rfc3339(&s)
            .map(|dt| dt.with_timezone(&Utc))
            .map_err(serde::de::Error::custom)
    }
}
