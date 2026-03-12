use crate::util::is_empty_slice;
use serde::Serialize;
use serde_json::{Map, Value};
use std::borrow::Cow;

use crate::{QueryType, ToOpenSearchJson};

/// Bool Query
#[derive(Default, Debug, Clone, Serialize)]
pub struct BoolQuery<'a> {
    /// Must queries
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub must: Cow<'a, [QueryType<'a>]>,
    /// Must not queries
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub must_not: Cow<'a, [QueryType<'a>]>,
    /// Should queries
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub should: Cow<'a, [QueryType<'a>]>,
    /// Filter queries
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub filter: Cow<'a, [QueryType<'a>]>,
    /// Minimum should match
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_should_match: Option<i32>,
    /// Boost
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<f64>,
}

impl<'a> BoolQuery<'a> {
    /// Create a new empty BoolQuery
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a must query
    pub fn must(mut self, query: QueryType<'a>) -> Self {
        self.must.to_mut().push(query);
        self
    }

    /// Add a must not query
    pub fn must_not(mut self, query: QueryType<'a>) -> Self {
        self.must_not.to_mut().push(query);
        self
    }

    /// Add a should query
    pub fn should(mut self, query: QueryType<'a>) -> Self {
        self.should.to_mut().push(query);
        self
    }

    /// Add a filter query
    pub fn filter(mut self, query: QueryType<'a>) -> Self {
        self.filter.to_mut().push(query);
        self
    }

    /// Set the minimum should match
    pub fn minimum_should_match(mut self, min: i32) -> Self {
        self.minimum_should_match = Some(min);
        self
    }

    /// Set the boost
    pub fn boost(mut self, boost: f64) -> Self {
        self.boost = Some(boost);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> BoolQuery<'static> {
        BoolQuery {
            must: Cow::Owned(self.must.iter().map(|q| q.to_owned()).collect()),
            must_not: Cow::Owned(self.must_not.iter().map(|q| q.to_owned()).collect()),
            should: Cow::Owned(self.should.iter().map(|q| q.to_owned()).collect()),
            filter: Cow::Owned(self.filter.iter().map(|q| q.to_owned()).collect()),
            minimum_should_match: self.minimum_should_match,
            boost: self.boost,
        }
    }
}

impl<'a> From<BoolQuery<'a>> for QueryType<'a> {
    fn from(bool_query: BoolQuery<'a>) -> Self {
        QueryType::Bool(bool_query)
    }
}

impl<'a> ToOpenSearchJson for BoolQuery<'a> {
    fn to_json(&self) -> Value {
        let mut bool_obj = Map::new();

        if !self.must.is_empty() {
            let must_queries: Vec<Value> = self.must.iter().map(|q| q.to_json()).collect();
            bool_obj.insert("must".to_string(), Value::Array(must_queries));
        }

        if !self.must_not.is_empty() {
            let must_not_queries: Vec<Value> = self.must_not.iter().map(|q| q.to_json()).collect();
            bool_obj.insert("must_not".to_string(), Value::Array(must_not_queries));
        }

        if !self.should.is_empty() {
            let should_queries: Vec<Value> = self.should.iter().map(|q| q.to_json()).collect();
            bool_obj.insert("should".to_string(), Value::Array(should_queries));
        }

        if !self.filter.is_empty() {
            let filter_queries: Vec<Value> = self.filter.iter().map(|f| f.to_json()).collect();
            bool_obj.insert("filter".to_string(), Value::Array(filter_queries));
        }

        if let Some(min) = self.minimum_should_match {
            bool_obj.insert(
                "minimum_should_match".to_string(),
                Value::Number(min.into()),
            );
        }

        if let Some(boost) = self.boost {
            bool_obj.insert("boost".to_string(), boost.into());
        }

        let mut result = Map::new();
        result.insert("bool".to_string(), Value::Object(bool_obj));
        Value::Object(result)
    }
}

/// Builder pattern for BoolQuery that allows dynamic updates.
#[derive(Default, Debug, Clone)]
pub struct BoolQueryBuilder<'a> {
    must: Cow<'a, [QueryType<'a>]>,
    must_not: Cow<'a, [QueryType<'a>]>,
    should: Cow<'a, [QueryType<'a>]>,
    filter: Cow<'a, [QueryType<'a>]>,
    minimum_should_match: Option<i32>,
    boost: Option<f64>,
}

impl<'a> BoolQueryBuilder<'a> {
    /// Create a new empty BoolQueryBuilder
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a must query
    pub fn must(&mut self, query: QueryType<'a>) -> &mut Self {
        self.must.to_mut().push(query);
        self
    }

    /// Add a must not query
    pub fn must_not(&mut self, query: QueryType<'a>) -> &mut Self {
        self.must_not.to_mut().push(query);
        self
    }

    /// Add a should query
    pub fn should(&mut self, query: QueryType<'a>) -> &mut Self {
        self.should.to_mut().push(query);
        self
    }

    /// Add a filter query
    pub fn filter(&mut self, query: QueryType<'a>) -> &mut Self {
        self.filter.to_mut().push(query);
        self
    }

    /// Set the minimum should match
    pub fn minimum_should_match(&mut self, min: i32) -> &mut Self {
        self.minimum_should_match = Some(min);
        self
    }

    /// Set the boost
    pub fn boost(&mut self, boost: f64) -> &mut Self {
        self.boost = Some(boost);
        self
    }

    /// Build the final BoolQuery
    pub fn build(self) -> BoolQuery<'a> {
        BoolQuery {
            must: self.must,
            must_not: self.must_not,
            should: self.should,
            filter: self.filter,
            minimum_should_match: self.minimum_should_match,
            boost: self.boost,
        }
    }
}

#[cfg(test)]
mod test;
