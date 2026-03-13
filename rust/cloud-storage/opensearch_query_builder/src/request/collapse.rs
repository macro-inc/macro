use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::ToOpenSearchJson;

/// Collapse
#[derive(Debug, Clone, Serialize)]
pub struct Collapse<'a> {
    /// The field to collapse on
    #[serde(borrow)]
    pub field: Cow<'a, str>,
}

impl<'a> Collapse<'a> {
    /// Create a new Collapse
    pub fn new(field: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
        }
    }
}

impl<'a> ToOpenSearchJson for Collapse<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        result.insert("field".to_string(), Value::String(self.field.to_string()));
        Value::Object(result)
    }
}
