use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Sensitive text, zeroized on drop and redacted in all ordinary formatting.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(transparent)]
pub struct SecretString(String);

impl SecretString {
    /// Take ownership of sensitive text without logging it.
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// Deliberately expose the value for a single protocol operation.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretString([REDACTED])")
    }
}

/// Arbitrary KV data; its wire representation has no public formatting surface.
#[derive(Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretData(pub(crate) serde_json::Map<String, serde_json::Value>);

impl std::fmt::Debug for SecretData {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretData([REDACTED])")
    }
}

impl Drop for SecretData {
    fn drop(&mut self) {
        fn clear(value: &mut serde_json::Value) {
            match value {
                serde_json::Value::String(text) => text.zeroize(),
                serde_json::Value::Array(values) => values.iter_mut().for_each(clear),
                serde_json::Value::Object(values) => {
                    for (mut key, mut value) in std::mem::take(values) {
                        key.zeroize();
                        clear(&mut value);
                    }
                }
                _ => {}
            }
        }
        for (mut key, mut value) in std::mem::take(&mut self.0) {
            key.zeroize();
            clear(&mut value);
        }
    }
}
