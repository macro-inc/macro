//! Ephemeral persona enrollment material; never part of durable computer state.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::enrollment::{PersonaConfigKey, PersonaFieldError};

/// Identifies one creation of a computer's guest, including retries of that creation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EnrollmentGeneration(u32);

impl EnrollmentGeneration {
    /// Construct a persisted generation; zero means no guest has been created.
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    /// The persisted counter value.
    pub const fn get(self) -> u32 {
        self.0
    }

    /// Reserve the next creation without wrapping the counter.
    pub fn next(self) -> Option<Self> {
        self.0.checked_add(1).map(Self)
    }
}

/// Issuance fails closed; errors must never contain credential values.
#[derive(Debug, thiserror::Error)]
pub enum PersonaCredentialError {
    /// No provider has been composed for a persona computer.
    #[error("persona credential source is not configured")]
    Unavailable,
    /// The addressed computer no longer exists.
    #[error("persona computer not found")]
    NotFound,
    /// The source failed; deliberately carries no provider response body.
    #[error("persona enrollment issuance failed")]
    IssuanceFailed,
    /// Invalid non-secret environment key.
    #[error(transparent)]
    Field(#[from] PersonaFieldError),
    /// Environment values cannot inject additional lines.
    #[error("persona enrollment values must be single lines")]
    MultilineValue,
}

/// A validated map of credentials, redacted in Debug and wiped on drop.
/// It deliberately does not implement Serialize.
///
/// ```compile_fail
/// use hosted_runtimes::domain::persona_credentials::PersonaCredentials;
/// let _ = serde_json::to_string(&PersonaCredentials::default());
/// ```
#[derive(Clone, Default, PartialEq, Eq)]
pub struct PersonaCredentials(BTreeMap<PersonaConfigKey, String>);

impl PersonaCredentials {
    /// Take ownership of validated environment names and single-line values.
    pub fn new(values: BTreeMap<PersonaConfigKey, String>) -> Result<Self, PersonaCredentialError> {
        let credentials = Self(values);
        validate_values(&credentials.0)?;
        Ok(credentials)
    }

    /// Expose plaintext only while building the one-time enrollment or guest env file.
    pub fn expose(&self) -> &BTreeMap<PersonaConfigKey, String> {
        &self.0
    }
}

impl std::fmt::Debug for PersonaCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PersonaCredentials")
            .field("keys", &self.0.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl Drop for PersonaCredentials {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            zeroize::Zeroize::zeroize(value);
        }
    }
}

impl<'de> Deserialize<'de> for PersonaCredentials {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(BTreeMap::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// Validated non-secret env supplied at issuance, also excluded from persistence.
///
/// ```compile_fail
/// use hosted_runtimes::domain::persona_credentials::PersonaEnv;
/// let _ = serde_json::to_string(&PersonaEnv::default());
/// ```
#[derive(Clone, Default, PartialEq, Eq)]
pub struct PersonaEnv(BTreeMap<PersonaConfigKey, String>);

impl PersonaEnv {
    /// Reject reserved credential names and multiline values.
    pub fn new(values: BTreeMap<PersonaConfigKey, String>) -> Result<Self, PersonaCredentialError> {
        for key in values.keys() {
            key.validate_non_secret()?;
        }
        validate_values(&values)?;
        Ok(Self(values))
    }

    /// Non-secret environment, for the one-time enrollment only.
    pub fn as_map(&self) -> &BTreeMap<PersonaConfigKey, String> {
        &self.0
    }
}

impl std::fmt::Debug for PersonaEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PersonaEnv")
            .field("keys", &self.0.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl<'de> Deserialize<'de> for PersonaEnv {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(BTreeMap::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// Returned fresh on every issue call. Neither half belongs in durable state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct PersonaEnrollment {
    /// Rotating bootstrap credentials.
    pub secrets: PersonaCredentials,
    /// Non-secret deployment environment supplied by the credential provider.
    pub env: PersonaEnv,
}

/// Serialize only from Enrollment's explicit one-time transport field.
pub(super) fn serialize_enrollment<S: serde::Serializer>(
    enrollment: &PersonaEnrollment,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeStruct;
    let mut fields = serializer.serialize_struct("PersonaEnrollment", 2)?;
    fields.serialize_field("secrets", enrollment.secrets.expose())?;
    fields.serialize_field("env", enrollment.env.as_map())?;
    fields.end()
}

fn validate_values(
    values: &BTreeMap<PersonaConfigKey, String>,
) -> Result<(), PersonaCredentialError> {
    if values.values().any(|value| value.contains(['\n', '\r'])) {
        return Err(PersonaCredentialError::MultilineValue);
    }
    Ok(())
}

#[cfg(test)]
mod test;
