use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

/// Script score configuration
#[derive(Debug, Clone, Serialize)]
pub struct ScriptScore<'a> {
    /// The script to use for scoring
    #[serde(borrow)]
    pub source: Cow<'a, str>,
    /// The parameters to use for scoring
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Map<String, Value>>,
}

impl<'a> ScriptScore<'a> {
    /// Create a new ScriptScore
    pub fn new(source: impl Into<Cow<'a, str>>) -> Self {
        Self {
            source: source.into(),
            params: None,
        }
    }

    /// Set the parameters
    pub fn params(mut self, params: Map<String, Value>) -> Self {
        self.params = Some(params);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> ScriptScore<'static> {
        ScriptScore {
            source: Cow::Owned(self.source.to_string()),
            params: self.params.clone(),
        }
    }
}
