use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

#[cfg(test)]
mod test;

/// `match_bool_prefix` query: analyzes the text, matches every token but the
/// last as a term and the last as a prefix. One token becomes a plain prefix
/// query over every term that starts with it, scored as a constant.
#[derive(Debug, Clone, Serialize)]
pub struct MatchBoolPrefixQuery<'a> {
    /// The field to search
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The query text
    #[serde(borrow)]
    pub query: Cow<'a, str>,
    /// Whether every token must match (`and`) or any (`or`, the default)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(borrow)]
    pub operator: Option<Cow<'a, str>>,
}

impl<'a> MatchBoolPrefixQuery<'a> {
    /// Create a new MatchBoolPrefixQuery with a given field and query text
    pub fn new(field: impl Into<Cow<'a, str>>, query: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            query: query.into(),
            operator: None,
        }
    }

    /// Set whether every token must match or any
    pub fn operator(mut self, operator: impl Into<Cow<'a, str>>) -> Self {
        self.operator = Some(operator.into());
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> MatchBoolPrefixQuery<'static> {
        MatchBoolPrefixQuery {
            field: Cow::Owned(self.field.to_string()),
            query: Cow::Owned(self.query.to_string()),
            operator: self.operator.as_ref().map(|o| Cow::Owned(o.to_string())),
        }
    }
}

impl<'a> From<MatchBoolPrefixQuery<'a>> for QueryType<'a> {
    fn from(match_bool_prefix_query: MatchBoolPrefixQuery<'a>) -> Self {
        QueryType::MatchBoolPrefix(match_bool_prefix_query)
    }
}

impl<'a> ToOpenSearchJson for MatchBoolPrefixQuery<'a> {
    fn to_json(&self) -> Value {
        let mut field_obj = Map::new();
        field_obj.insert("query".to_string(), Value::String(self.query.to_string()));
        if let Some(ref operator) = self.operator {
            field_obj.insert("operator".to_string(), Value::String(operator.to_string()));
        }

        let mut match_bool_prefix_obj = Map::new();
        match_bool_prefix_obj.insert(self.field.to_string(), Value::Object(field_obj));

        let mut result = Map::new();
        result.insert(
            "match_bool_prefix".to_string(),
            Value::Object(match_bool_prefix_obj),
        );
        Value::Object(result)
    }
}
