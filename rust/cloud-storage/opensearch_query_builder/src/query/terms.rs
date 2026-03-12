use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// Terms Query
#[derive(Debug, Clone, Serialize)]
pub struct TermsQuery<'a> {
    /// The field to search
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The values to search for
    #[serde(borrow)]
    pub values: Cow<'a, [Value]>,
    /// The boost value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<f64>,
}

impl<'a> TermsQuery<'a> {
    /// Create a new TermsQuery with a given field and values
    pub fn new<T: Into<Value>>(
        field: impl Into<Cow<'a, str>>,
        values: impl IntoIterator<Item = T>,
    ) -> Self {
        Self {
            field: field.into(),
            values: Cow::Owned(values.into_iter().map(|v| v.into()).collect()),
            boost: None,
        }
    }

    /// Set the boost value
    pub fn boost(mut self, boost: f64) -> Self {
        self.boost = Some(boost);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> TermsQuery<'static> {
        TermsQuery {
            field: Cow::Owned(self.field.to_string()),
            values: Cow::Owned(self.values.to_vec()),
            boost: self.boost,
        }
    }
}

impl<'a> From<TermsQuery<'a>> for QueryType<'a> {
    fn from(terms_query: TermsQuery<'a>) -> Self {
        QueryType::Terms(terms_query)
    }
}

impl<'a> ToOpenSearchJson for TermsQuery<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        let mut terms_obj = Map::new();

        if self.boost.is_some() {
            // Complex form with boost
            let mut field_obj = Map::new();
            field_obj.insert("terms".to_string(), Value::Array(self.values.to_vec()));
            if let Some(boost) = self.boost {
                field_obj.insert("boost".to_string(), boost.into());
            }
            terms_obj.insert(self.field.to_string(), Value::Object(field_obj));
        } else {
            // Simple form: field: [values]
            terms_obj.insert(self.field.to_string(), Value::Array(self.values.to_vec()));
        }

        result.insert("terms".to_string(), Value::Object(terms_obj));
        Value::Object(result)
    }
}
