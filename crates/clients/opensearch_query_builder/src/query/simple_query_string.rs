use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// Simple Query String Query
///
/// Searches across multiple fields using a simple query syntax that supports
/// operators like `+` (AND), `|` (OR), `-` (NOT), `*` (wildcard), and `()` (grouping).
#[derive(Debug, Clone, Serialize)]
pub struct SimpleQueryStringQuery<'a> {
    /// The query string
    #[serde(borrow)]
    pub query: Cow<'a, str>,
    /// The fields to search
    pub fields: Vec<Cow<'a, str>>,
    /// The default operator (AND or OR)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(borrow)]
    pub default_operator: Option<Cow<'a, str>>,
}

impl<'a> SimpleQueryStringQuery<'a> {
    /// Create a new SimpleQueryStringQuery with a query string and fields
    pub fn new(
        query: impl Into<Cow<'a, str>>,
        fields: impl IntoIterator<Item = impl Into<Cow<'a, str>>>,
    ) -> Self {
        Self {
            query: query.into(),
            fields: fields.into_iter().map(|f| f.into()).collect(),
            default_operator: None,
        }
    }

    /// Set the default operator (AND or OR)
    pub fn default_operator(mut self, operator: impl Into<Cow<'a, str>>) -> Self {
        self.default_operator = Some(operator.into());
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> SimpleQueryStringQuery<'static> {
        SimpleQueryStringQuery {
            query: Cow::Owned(self.query.to_string()),
            fields: self
                .fields
                .iter()
                .map(|f| Cow::Owned(f.to_string()))
                .collect(),
            default_operator: self
                .default_operator
                .as_ref()
                .map(|o| Cow::Owned(o.to_string())),
        }
    }
}

impl<'a> From<SimpleQueryStringQuery<'a>> for QueryType<'a> {
    fn from(query: SimpleQueryStringQuery<'a>) -> Self {
        QueryType::SimpleQueryString(query)
    }
}

impl<'a> ToOpenSearchJson for SimpleQueryStringQuery<'a> {
    fn to_json(&self) -> Value {
        let mut inner = Map::new();
        inner.insert("query".to_string(), Value::String(self.query.to_string()));
        inner.insert(
            "fields".to_string(),
            Value::Array(
                self.fields
                    .iter()
                    .map(|f| Value::String(f.to_string()))
                    .collect(),
            ),
        );

        if let Some(ref operator) = self.default_operator {
            inner.insert(
                "default_operator".to_string(),
                Value::String(operator.to_string()),
            );
        }

        let mut result = Map::new();
        result.insert("simple_query_string".to_string(), Value::Object(inner));
        Value::Object(result)
    }
}
