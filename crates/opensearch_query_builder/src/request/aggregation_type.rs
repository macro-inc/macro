use std::borrow::Cow;
use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::ToOpenSearchJson;

/// Cardinality Aggregation
#[derive(Debug, Clone, Serialize)]
pub struct CardinalityAggregation<'a> {
    /// The field to aggregate
    #[serde(borrow)]
    pub field: Cow<'a, str>,
}

impl<'a> CardinalityAggregation<'a> {
    /// Create a new CardinalityAggregation
    pub fn new(field: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
        }
    }
}

impl<'a> ToOpenSearchJson for CardinalityAggregation<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        let mut cardinality_obj = Map::new();
        cardinality_obj.insert("field".to_string(), Value::String(self.field.to_string()));
        result.insert("cardinality".to_string(), Value::Object(cardinality_obj));
        Value::Object(result)
    }
}

/// Terms Aggregation
#[derive(Debug, Clone, Serialize)]
pub struct TermsAggregation<'a> {
    /// The field to aggregate
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The maximum number of terms to return
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
    /// Sub-aggregations
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    pub sub_aggs: HashMap<Cow<'a, str>, AggregationType<'a>>,
}

impl<'a> TermsAggregation<'a> {
    /// Create a new TermsAggregation
    pub fn new(field: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            size: None,
            sub_aggs: HashMap::new(),
        }
    }

    /// Set the maximum number of terms to return
    pub fn size(mut self, size: u32) -> Self {
        self.size = Some(size);
        self
    }

    /// Add a sub-aggregation
    pub fn sub_agg(mut self, name: impl Into<Cow<'a, str>>, agg: AggregationType<'a>) -> Self {
        self.sub_aggs.insert(name.into(), agg);
        self
    }
}

impl<'a> ToOpenSearchJson for TermsAggregation<'a> {
    fn to_json(&self) -> Value {
        let mut terms_obj = Map::new();
        terms_obj.insert("field".to_string(), Value::String(self.field.to_string()));

        if let Some(size) = self.size {
            terms_obj.insert("size".to_string(), Value::Number(size.into()));
        }

        let mut result = Map::new();
        result.insert("terms".to_string(), Value::Object(terms_obj));

        if !self.sub_aggs.is_empty() {
            let mut aggs_obj = Map::new();
            for (name, agg) in &self.sub_aggs {
                aggs_obj.insert(name.to_string(), agg.to_json());
            }
            result.insert("aggs".to_string(), Value::Object(aggs_obj));
        }

        Value::Object(result)
    }
}

/// Aggregation Type
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "params")]
pub enum AggregationType<'a> {
    /// Terms aggregation
    Terms(TermsAggregation<'a>),
    /// Cardinality aggregation
    Cardinality(CardinalityAggregation<'a>),
}

impl<'a> ToOpenSearchJson for AggregationType<'a> {
    fn to_json(&self) -> Value {
        match self {
            AggregationType::Terms(terms) => terms.to_json(),
            AggregationType::Cardinality(cardinality) => cardinality.to_json(),
        }
    }
}
