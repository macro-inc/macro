use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer};

/// Deserializes an optional datetime string permissively, accepting many common formats
/// (e.g. "2025-11-25 12:00:09 EST", "March 5, 2025", "2025-01-01T00:00:00Z", etc.).
pub fn deserialize_permissive_datetime_opt<'de, D>(
    deserializer: D,
) -> Result<Option<DateTime<Utc>>, D::Error>
where
    D: Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(deserializer)?;
    match s {
        Some(s) if !s.is_empty() => dateparser::parse(&s)
            .map(Some)
            .map_err(serde::de::Error::custom),
        _ => Ok(None),
    }
}
