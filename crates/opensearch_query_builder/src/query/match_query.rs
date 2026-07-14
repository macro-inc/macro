use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// Match Query
#[derive(Debug, Clone, Serialize)]
pub struct MatchQuery<'a> {
    /// The field to search
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The query string
    #[serde(borrow)]
    pub query: Cow<'a, str>,
    /// The operator to use
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(borrow)]
    pub operator: Option<Cow<'a, str>>,
    /// The fuzziness value
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(borrow)]
    pub fuzziness: Option<Cow<'a, str>>,
    /// The boost value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<f64>,
    /// The minimum should match value
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(borrow)]
    pub minimum_should_match: Option<Cow<'a, str>>,
}

impl<'a> MatchQuery<'a> {
    /// Create a new MatchQuery with a given field and query string
    pub fn new(field: impl Into<Cow<'a, str>>, query: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            query: query.into(),
            operator: None,
            fuzziness: None,
            boost: None,
            minimum_should_match: None,
        }
    }

    /// Set the operator to use
    pub fn operator(mut self, operator: impl Into<Cow<'a, str>>) -> Self {
        self.operator = Some(operator.into());
        self
    }

    /// Set the fuzziness value
    pub fn fuzziness(mut self, fuzziness: impl Into<Cow<'a, str>>) -> Self {
        self.fuzziness = Some(fuzziness.into());
        self
    }

    /// Set the boost value
    pub fn boost(mut self, boost: f64) -> Self {
        self.boost = Some(boost);
        self
    }

    /// Set the minimum should match value
    pub fn minimum_should_match(mut self, minimum_should_match: impl Into<Cow<'a, str>>) -> Self {
        self.minimum_should_match = Some(minimum_should_match.into());
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> MatchQuery<'static> {
        MatchQuery {
            field: Cow::Owned(self.field.to_string()),
            query: Cow::Owned(self.query.to_string()),
            operator: self.operator.as_ref().map(|o| Cow::Owned(o.to_string())),
            fuzziness: self.fuzziness.as_ref().map(|f| Cow::Owned(f.to_string())),
            boost: self.boost,
            minimum_should_match: self
                .minimum_should_match
                .as_ref()
                .map(|m| Cow::Owned(m.to_string())),
        }
    }
}

impl<'a> From<MatchQuery<'a>> for QueryType<'a> {
    fn from(match_query: MatchQuery<'a>) -> Self {
        QueryType::Match(match_query)
    }
}

impl<'a> ToOpenSearchJson for MatchQuery<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        let mut match_obj = Map::new();

        // Check if we need the complex form
        let has_options = self.operator.is_some()
            || self.fuzziness.is_some()
            || self.boost.is_some()
            || self.minimum_should_match.is_some();

        if has_options {
            let mut field_obj = Map::new();
            field_obj.insert("query".to_string(), Value::String(self.query.to_string()));

            if let Some(ref operator) = self.operator {
                field_obj.insert("operator".to_string(), Value::String(operator.to_string()));
            }
            if let Some(ref fuzziness) = self.fuzziness {
                field_obj.insert(
                    "fuzziness".to_string(),
                    Value::String(fuzziness.to_string()),
                );
            }
            if let Some(boost) = self.boost {
                field_obj.insert("boost".to_string(), boost.into());
            }

            if let Some(ref minimum_should_match) = self.minimum_should_match {
                field_obj.insert(
                    "minimum_should_match".to_string(),
                    Value::String(minimum_should_match.to_string()),
                );
            }

            match_obj.insert(self.field.to_string(), Value::Object(field_obj));
        } else {
            // Simple form: field: "query"
            match_obj.insert(
                self.field.to_string(),
                Value::String(self.query.to_string()),
            );
        }

        result.insert("match".to_string(), Value::Object(match_obj));
        Value::Object(result)
    }
}
