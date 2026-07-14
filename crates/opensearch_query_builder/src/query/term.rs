use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// Term Query
#[derive(Debug, Clone, Serialize)]
pub struct TermQuery<'a> {
    /// The field to search
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The value to search for
    pub value: Value,
    /// The boost value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<f64>,
}

impl<'a> TermQuery<'a> {
    /// Create a new TermQuery with a given field and value
    pub fn new<T: Into<Value>>(field: impl Into<Cow<'a, str>>, value: T) -> Self {
        Self {
            field: field.into(),
            value: value.into(),
            boost: None,
        }
    }

    /// Set the boost value
    pub fn boost(mut self, boost: f64) -> Self {
        self.boost = Some(boost);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> TermQuery<'static> {
        TermQuery {
            field: Cow::Owned(self.field.to_string()),
            value: self.value.clone(),
            boost: self.boost,
        }
    }
}

impl<'a> From<TermQuery<'a>> for QueryType<'a> {
    fn from(term_query: TermQuery<'a>) -> Self {
        QueryType::Term(term_query)
    }
}

impl<'a> ToOpenSearchJson for TermQuery<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        let mut term_obj = Map::new();

        // If we have additional parameters like boost, use the object form
        if self.boost.is_some() {
            let mut field_obj = Map::new();
            field_obj.insert("value".to_string(), self.value.clone());
            if let Some(boost) = self.boost {
                field_obj.insert("boost".to_string(), boost.into());
            }
            term_obj.insert(self.field.to_string(), Value::Object(field_obj));
        } else {
            // Simple form: just field: value
            term_obj.insert(self.field.to_string(), self.value.clone());
        }

        result.insert("term".to_string(), Value::Object(term_obj));
        Value::Object(result)
    }
}
