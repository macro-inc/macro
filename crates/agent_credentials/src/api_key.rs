use std::fmt;

use serde::{Deserialize, Serialize};
use user_api_key::domain::models::UserApiKey;
use zeroize::Zeroizing;

use crate::InvalidAgentCredential;

/// An agent's revocable Macro API key. Unlike the legacy user-key boundary,
/// bootstrap keys must have the current minted shape. Debug reveals no suffix;
/// the owned plaintext is zeroized when dropped.
#[derive(Clone, Deserialize)]
#[serde(try_from = "String")]
pub struct AgentApiKey(Zeroizing<String>);

impl AgentApiKey {
    /// Validate a newly minted, saved or presented agent API key.
    pub fn parse(raw: String) -> Result<Self, InvalidAgentCredential> {
        let raw = Zeroizing::new(raw);
        if !lazy_regex::regex_is_match!(r"^mak_[0-9a-f]{64}$", raw.as_str()) {
            return Err(InvalidAgentCredential);
        }
        Ok(Self(raw))
    }

    /// Read the key only for authentication or bootstrap configuration.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for AgentApiKey {
    type Error = InvalidAgentCredential;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(raw)
    }
}

impl TryFrom<UserApiKey> for AgentApiKey {
    type Error = InvalidAgentCredential;

    fn try_from(key: UserApiKey) -> Result<Self, Self::Error> {
        Self::parse(key.expose().to_owned())
    }
}

impl Serialize for AgentApiKey {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.expose())
    }
}

impl PartialEq for AgentApiKey {
    fn eq(&self, other: &Self) -> bool {
        constant_time_eq::constant_time_eq(self.expose().as_bytes(), other.expose().as_bytes())
    }
}

impl Eq for AgentApiKey {}

impl fmt::Debug for AgentApiKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AgentApiKey(redacted)")
    }
}

#[cfg(test)]
mod test;
