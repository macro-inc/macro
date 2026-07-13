//! Module provides a wrapper utility for a stringified value which is potentially urlencoded.
//! This is useful for urls which may or may not be url encoded, both scenarios will successfully deserialize the url
use super::*;

#[cfg(test)]
mod tests;

/// A structure which encodes a string which is url encoded
#[derive(Debug, Deserialize, Serialize)]
#[serde(
    transparent,
    bound(
        serialize = "T: AsRef<str>",
        deserialize = "T: std::str::FromStr, T::Err: std::fmt::Display"
    )
)]
pub struct UrlEncoded<T>(#[serde(with = "serde_url")] pub T);

mod serde_url {
    use std::borrow::Cow;

    use serde::de::Error as DeError;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<T, S>(value: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        T: AsRef<str>,
        S: Serializer,
    {
        let encoded = urlencoding::encode(value.as_ref());
        serializer.serialize_str(&encoded)
    }

    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<T, D::Error>
    where
        T: std::str::FromStr,
        T::Err: std::fmt::Display,
        D: Deserializer<'de>,
    {
        let encoded = <Cow<'de, str>>::deserialize(deserializer)?;
        let decoded = urlencoding::decode(&encoded)
            .map_err(|e| DeError::custom(format!("URL decode error: {}", e)))?;

        T::from_str(&decoded).map_err(|e| DeError::custom(format!("Parse error: {}", e)))
    }
}
