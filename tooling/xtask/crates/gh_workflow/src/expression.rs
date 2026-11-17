//!
//! Expression types for GitHub workflow conditions and evaluations.

use serde::{Deserialize, Serialize};

/// Represents an expression used in conditions.
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(transparent)]
pub struct Expression(pub String);

impl Expression {
    /// Creates a new `Expression` from a string.
    pub fn new<T: ToString>(expr: T) -> Self {
        Self(expr.to_string())
    }
}

impl From<String> for Expression {
    fn from(text: String) -> Self {
        Self(text)
    }
}

impl From<&str> for Expression {
    fn from(text: &str) -> Self {
        Self(text.to_string())
    }
}
