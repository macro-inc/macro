use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// Match Phrase Prefix Query
#[derive(Debug, Clone, Serialize)]
pub struct MatchPhrasePrefixQuery<'a> {
    /// The field to search
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The query string
    #[serde(borrow)]
    pub query: Cow<'a, str>,
    /// The maximum number of terms that can be expanded upon
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_expansions: Option<u32>,
    /// The slop value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slop: Option<u32>,
    /// The boost value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<f64>,
}

impl<'a> MatchPhrasePrefixQuery<'a> {
    /// Create a new MatchPhrasePrefixQuery with a given field and query string
    pub fn new(field: impl Into<Cow<'a, str>>, query: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            query: query.into(),
            max_expansions: None,
            slop: None,
            boost: None,
        }
    }

    /// Set the maximum number of terms that can be expanded upon
    pub fn max_expansions(mut self, max_expansions: u32) -> Self {
        self.max_expansions = Some(max_expansions);
        self
    }

    /// Set the slop value
    pub fn slop(mut self, slop: u32) -> Self {
        self.slop = Some(slop);
        self
    }

    /// Set the boost value
    pub fn boost(mut self, boost: f64) -> Self {
        self.boost = Some(boost);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> MatchPhrasePrefixQuery<'static> {
        MatchPhrasePrefixQuery {
            field: Cow::Owned(self.field.to_string()),
            query: Cow::Owned(self.query.to_string()),
            max_expansions: self.max_expansions,
            slop: self.slop,
            boost: self.boost,
        }
    }
}

impl<'a> From<MatchPhrasePrefixQuery<'a>> for QueryType<'a> {
    fn from(match_phrase_prefix_query: MatchPhrasePrefixQuery<'a>) -> Self {
        QueryType::MatchPhrasePrefix(match_phrase_prefix_query)
    }
}

impl<'a> ToOpenSearchJson for MatchPhrasePrefixQuery<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        let mut match_phrase_prefix_obj = Map::new();
        let mut field_obj = Map::new();

        // Match phrase prefix always uses the complex form with "query" field
        field_obj.insert("query".to_string(), Value::String(self.query.to_string()));

        if let Some(max_expansions) = self.max_expansions {
            field_obj.insert(
                "max_expansions".to_string(),
                Value::Number(max_expansions.into()),
            );
        }
        if let Some(slop) = self.slop {
            field_obj.insert("slop".to_string(), Value::Number(slop.into()));
        }
        if let Some(boost) = self.boost {
            field_obj.insert("boost".to_string(), boost.into());
        }

        match_phrase_prefix_obj.insert(self.field.to_string(), Value::Object(field_obj));

        result.insert(
            "match_phrase_prefix".to_string(),
            Value::Object(match_phrase_prefix_obj),
        );
        Value::Object(result)
    }
}
