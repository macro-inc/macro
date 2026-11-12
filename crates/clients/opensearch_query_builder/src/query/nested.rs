use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// `nested` query. Returns documents whose nested objects under `path`
/// match `query` within a single nested entry.
///
/// `ignore_unmapped` is set so the query is a no-op (rather than an error)
/// on indices in a multi-index search that don't map `path` as nested.
#[derive(Debug, Clone, Serialize)]
pub struct NestedQuery<'a> {
    /// Path to the nested field.
    #[serde(borrow)]
    pub path: Cow<'a, str>,
    /// Query to run against each nested object. A parent matches if any one
    /// of its nested objects matches this query.
    pub query: Box<QueryType<'a>>,
    /// If true, suppress errors when `path` is not mapped as nested in the
    /// target index. Useful for unified queries that span heterogeneous
    /// indices, only some of which map the nested field.
    pub ignore_unmapped: Option<bool>,
}

impl<'a> NestedQuery<'a> {
    /// Create a new nested query against `path` running `query`.
    pub fn new(path: impl Into<Cow<'a, str>>, query: QueryType<'a>) -> Self {
        Self {
            path: path.into(),
            query: Box::new(query),
            ignore_unmapped: None,
        }
    }

    /// Ignore mapping errors when `path` is not mapped as nested on the
    /// target index.
    pub fn ignore_unmapped(mut self, ignore: bool) -> Self {
        self.ignore_unmapped = Some(ignore);
        self
    }

    /// Convert to an owned version with 'static lifetime.
    pub fn to_owned(&self) -> NestedQuery<'static> {
        NestedQuery {
            path: Cow::Owned(self.path.to_string()),
            query: Box::new((*self.query).to_owned()),
            ignore_unmapped: self.ignore_unmapped,
        }
    }
}

impl<'a> From<NestedQuery<'a>> for QueryType<'a> {
    fn from(q: NestedQuery<'a>) -> Self {
        QueryType::Nested(q)
    }
}

impl<'a> ToOpenSearchJson for NestedQuery<'a> {
    fn to_json(&self) -> Value {
        let mut inner = Map::new();
        inner.insert("path".to_string(), Value::String(self.path.to_string()));
        inner.insert("query".to_string(), self.query.to_json());
        if let Some(ignore) = self.ignore_unmapped {
            inner.insert("ignore_unmapped".to_string(), Value::Bool(ignore));
        }
        let mut outer = Map::new();
        outer.insert("nested".to_string(), Value::Object(inner));
        Value::Object(outer)
    }
}
