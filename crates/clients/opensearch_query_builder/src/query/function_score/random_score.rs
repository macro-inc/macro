use std::borrow::Cow;

use serde::Serialize;
use serde_json::Value;

/// Random score configuration
#[derive(Debug, Clone, Serialize, Default)]
pub struct RandomScore<'a> {
    /// The seed to use for randomizing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<Value>,
    /// The field to use for randomizing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<Cow<'a, str>>,
}

impl<'a> RandomScore<'a> {
    /// Create a new empty RandomScore
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the seed
    pub fn seed<T: Into<Value>>(mut self, seed: T) -> Self {
        self.seed = Some(seed.into());
        self
    }

    /// Set the field
    pub fn field(mut self, field: impl Into<Cow<'a, str>>) -> Self {
        self.field = Some(field.into());
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> RandomScore<'static> {
        RandomScore {
            seed: self.seed.clone(),
            field: self.field.as_ref().map(|f| Cow::Owned(f.to_string())),
        }
    }
}
