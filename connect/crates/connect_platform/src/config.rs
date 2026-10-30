use std::{collections::HashMap, str::FromStr};

/// A configuration loading error that names the offending variable.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// `APP_SECRETS_JSON` was malformed.
    #[error("APP_SECRETS_JSON contains invalid JSON: {0}")]
    InvalidSecretsJson(#[source] serde_json::Error),
    /// A required variable was absent.
    #[error("missing required config value: {0}")]
    Missing(&'static str),
    /// A variable could not be parsed as its expected type.
    #[error("invalid config value: {0}")]
    Invalid(&'static str),
    /// A process variable was not valid Unicode.
    #[error("invalid process variable: {0}")]
    InvalidProcessVariable(String),
}

/// A single snapshot of process configuration.
///
/// When `APP_SECRETS_JSON` is present, its keys are the sole source of values.
pub struct ConfigLoader {
    values: HashMap<String, String>,
}

impl ConfigLoader {
    /// Load the named process variables once at service startup.
    pub fn load(keys: &[&str]) -> Result<Self, ConfigError> {
        let mut values = HashMap::new();
        for key in std::iter::once("APP_SECRETS_JSON").chain(keys.iter().copied()) {
            #[expect(
                clippy::disallowed_methods,
                reason = "Connect reads its declared process configuration once at startup"
            )]
            let value = std::env::var(key);
            match value {
                Ok(value) => {
                    values.insert(key.to_owned(), value);
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(std::env::VarError::NotUnicode(_)) => {
                    return Err(ConfigError::InvalidProcessVariable(key.to_owned()));
                }
            }
            if key == "APP_SECRETS_JSON" && values.contains_key(key) {
                break;
            }
        }
        Self::from_values(values)
    }

    fn from_values(mut values: HashMap<String, String>) -> Result<Self, ConfigError> {
        if let Some(secrets) = values.remove("APP_SECRETS_JSON") {
            let parsed: HashMap<String, serde_json::Value> =
                serde_json::from_str(&secrets).map_err(ConfigError::InvalidSecretsJson)?;
            values = parsed
                .into_iter()
                .map(|(key, value)| {
                    let value = match value {
                        serde_json::Value::String(text) => text,
                        other => other.to_string(),
                    };
                    (key, value)
                })
                .collect();
        }
        Ok(Self { values })
    }

    /// Parse a required value or identify its missing or invalid key.
    pub fn required<T>(&self, key: &'static str) -> Result<T, ConfigError>
    where
        T: FromStr,
    {
        let value = self.values.get(key).ok_or(ConfigError::Missing(key))?;
        value.parse().map_err(|_| ConfigError::Invalid(key))
    }

    /// Parse a value, using `default` when it is absent.
    pub fn with_default<T>(&self, key: &'static str, default: T) -> Result<T, ConfigError>
    where
        T: FromStr,
    {
        match self.values.get(key) {
            Some(value) => value.parse().map_err(|_| ConfigError::Invalid(key)),
            None => Ok(default),
        }
    }

    /// Return an optional raw value from the same snapshot.
    pub fn optional(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }
}

#[cfg(test)]
mod test;
