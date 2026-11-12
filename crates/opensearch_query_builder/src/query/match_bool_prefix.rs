use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Value, json};

use crate::{QueryType, ToOpenSearchJson};

/// Match Bool Prefix Query: the analyzed tokens must all match, the last one
/// as a prefix. The prefix is a constant-score multi-term query, so it counts
/// as one clause against `max_clause_count` however many terms it matches.
#[derive(Debug, Clone, Serialize)]
pub struct MatchBoolPrefixQuery<'a> {
    /// The field to search
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The query string
    #[serde(borrow)]
    pub query: Cow<'a, str>,
}

impl<'a> MatchBoolPrefixQuery<'a> {
    /// Create a new MatchBoolPrefixQuery with a given field and query string
    pub fn new(field: impl Into<Cow<'a, str>>, query: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            query: query.into(),
        }
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> MatchBoolPrefixQuery<'static> {
        MatchBoolPrefixQuery {
            field: Cow::Owned(self.field.to_string()),
            query: Cow::Owned(self.query.to_string()),
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
        json!({ "match_bool_prefix": { self.field.as_ref(): { "query": self.query } } })
    }
}
