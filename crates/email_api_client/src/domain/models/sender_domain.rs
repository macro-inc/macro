use std::fmt;

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Longest DNS name, in characters.
const MAX_DOMAIN_CHARS: usize = 253;
/// Longest DNS label, in characters.
const MAX_LABEL_CHARS: usize = 63;

/// A lowercase DNS host name that mail is sent from, such as `linear.app`.
///
/// Holds only lowercase ASCII letters, digits, dots and hyphens, so adapters
/// can place it in a provider search query without quoting or escaping.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct SenderDomain(String);

/// Why a value is not a [`SenderDomain`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("sender domain must be a lowercase host name such as example.com")]
pub struct InvalidSenderDomain;

impl SenderDomain {
    /// Accepts a lowercase host name of at least two labels, each 1 to 63
    /// letters, digits or inner hyphens, at most 253 characters in all.
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidSenderDomain> {
        let value = value.into();
        let labels: Vec<&str> = value.split('.').collect();
        let valid = value.len() <= MAX_DOMAIN_CHARS
            && labels.len() >= 2
            && labels.iter().all(|label| is_valid_label(label));
        if !valid {
            return Err(InvalidSenderDomain);
        }

        Ok(Self(value))
    }

    /// The host name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn is_valid_label(label: &str) -> bool {
    let allowed = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';

    !label.is_empty()
        && label.len() <= MAX_LABEL_CHARS
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(allowed)
}

impl fmt::Display for SenderDomain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl TryFrom<String> for SenderDomain {
    type Error = InvalidSenderDomain;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<SenderDomain> for String {
    fn from(value: SenderDomain) -> Self {
        value.0
    }
}
