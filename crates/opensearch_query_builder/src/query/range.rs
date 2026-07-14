use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// Range Query
#[derive(Debug, Clone, Serialize)]
pub struct RangeQuery<'a> {
    /// The field to search
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// Greater than or equal to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gte: Option<Value>,
    /// Greater than
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gt: Option<Value>,
    /// Less than or equal to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lte: Option<Value>,
    /// Less than
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lt: Option<Value>,
    /// The boost value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<f64>,
}

impl<'a> RangeQuery<'a> {
    /// Create a new RangeQuery with a given field
    pub fn new(field: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            gte: None,
            gt: None,
            lte: None,
            lt: None,
            boost: None,
        }
    }

    /// Sets the greater than or equal to value
    pub fn gte<T: Into<Value>>(mut self, value: T) -> Self {
        self.gte = Some(value.into());
        self
    }
    /// Sets the greater than value
    pub fn gt<T: Into<Value>>(mut self, value: T) -> Self {
        self.gt = Some(value.into());
        self
    }
    /// Sets the less than or equal to value
    pub fn lte<T: Into<Value>>(mut self, value: T) -> Self {
        self.lte = Some(value.into());
        self
    }
    /// Sets the less than value
    pub fn lt<T: Into<Value>>(mut self, value: T) -> Self {
        self.lt = Some(value.into());
        self
    }

    /// Set the boost value
    pub fn boost(mut self, boost: f64) -> Self {
        self.boost = Some(boost);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> RangeQuery<'static> {
        RangeQuery {
            field: Cow::Owned(self.field.to_string()),
            gte: self.gte.clone(),
            gt: self.gt.clone(),
            lte: self.lte.clone(),
            lt: self.lt.clone(),
            boost: self.boost,
        }
    }
}

impl<'a> From<RangeQuery<'a>> for QueryType<'a> {
    fn from(range_query: RangeQuery<'a>) -> Self {
        QueryType::Range(range_query)
    }
}

impl<'a> ToOpenSearchJson for RangeQuery<'a> {
    fn to_json(&self) -> Value {
        let mut range_obj = Map::new();
        let mut field_obj = Map::new();

        if let Some(ref gte) = self.gte {
            field_obj.insert("gte".to_string(), gte.clone());
        }
        if let Some(ref gt) = self.gt {
            field_obj.insert("gt".to_string(), gt.clone());
        }
        if let Some(ref lte) = self.lte {
            field_obj.insert("lte".to_string(), lte.clone());
        }
        if let Some(ref lt) = self.lt {
            field_obj.insert("lt".to_string(), lt.clone());
        }
        if let Some(boost) = self.boost {
            field_obj.insert("boost".to_string(), boost.into());
        }

        range_obj.insert(self.field.to_string(), Value::Object(field_obj));

        let mut result = Map::new();
        result.insert("range".to_string(), Value::Object(range_obj));
        Value::Object(result)
    }
}

/// Builder pattern for RangeQuery that allows dynamic updates.
pub struct RangeQueryBuilder<'a> {
    /// The field to search
    #[allow(dead_code)]
    pub field: Cow<'a, str>,
    /// Greater than or equal to
    pub gte: Option<Value>,
    /// Greater than
    pub gt: Option<Value>,
    /// Less than or equal to
    pub lte: Option<Value>,
    /// Less than
    pub lt: Option<Value>,
    /// The boost value
    pub boost: Option<f64>,
}

impl<'a> RangeQueryBuilder<'a> {
    /// Create a new empty RangeQueryBuilder
    pub fn new(field: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            gte: None,
            gt: None,
            lte: None,
            lt: None,
            boost: None,
        }
    }

    /// Sets the greater than or equal to value
    pub fn gte<T: Into<Value>>(&mut self, value: T) -> &mut Self {
        self.gte = Some(value.into());
        self
    }

    /// Sets the greater than value
    pub fn gt<T: Into<Value>>(&mut self, value: T) -> &mut Self {
        self.gt = Some(value.into());
        self
    }

    /// Sets the less than or equal to value
    pub fn lte<T: Into<Value>>(&mut self, value: T) -> &mut Self {
        self.lte = Some(value.into());
        self
    }

    /// Sets the less than value
    pub fn lt<T: Into<Value>>(&mut self, value: T) -> &mut Self {
        self.lt = Some(value.into());
        self
    }

    /// Set the boost value
    pub fn boost(&mut self, boost: f64) -> &mut Self {
        self.boost = Some(boost);
        self
    }

    /// Build the final RangeQuery
    pub fn build(self) -> RangeQuery<'a> {
        RangeQuery {
            field: self.field,
            gte: self.gte,
            gt: self.gt,
            lte: self.lte,
            lt: self.lt,
            boost: self.boost,
        }
    }
}
