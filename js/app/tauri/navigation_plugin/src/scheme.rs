use std::ops::Deref;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
#[non_exhaustive]
pub struct MacroScheme(pub Url);

impl MacroScheme {
    pub fn new(url: Url) -> Result<Self, SchemeError> {
        let "macro" = url.scheme() else {
            return Err(SchemeError::InvalidScheme {
                expected: "macro".to_string(),
                found: url.scheme().to_string(),
            });
        };
        Ok(Self(url))
    }
    /// turn a http(s) url into a macro scheme url
    #[tracing::instrument(err, ret)]
    pub fn from_url(url: &Url) -> Result<Self, SchemeError> {
        let ("http" | "https" | "tauri") = url.scheme() else {
            return Err(SchemeError::InvalidScheme {
                expected: "http(s) or tauri".to_string(),
                found: url.scheme().to_string(),
            });
        };

        let mut rest = url.fragment().unwrap_or(url.path()).trim_start_matches('/');
        // Mobile router uses '/' as base, so strip the 'app/' prefix from universal links
        if rest.starts_with("app/") {
            rest = &rest[4..];
        }
        let query = url.query();
        let inner = match query {
            Some(q) => format!("macro:///{rest}?{q}"),
            None => format!("macro:///{rest}"),
        }
        .parse::<Url>()?;
        Ok(MacroScheme(inner))
    }
}

impl AsRef<str> for MacroScheme {
    fn as_ref(&self) -> &str {
        self.0.as_str()
    }
}

impl Deref for MacroScheme {
    type Target = Url;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[derive(Debug, Error)]
pub enum SchemeError {
    #[error("The input url did not have a fragment")]
    MissingPathOrFragment,
    #[error("{0}")]
    Parse(#[from] url::ParseError),
    #[error("Invalid scheme received. Expected {expected}, found {found}")]
    InvalidScheme { expected: String, found: String },
}
