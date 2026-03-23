use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::ToOpenSearchJson;

mod script;

pub use script::*;

/// Sort Order
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    /// Ascending
    Asc,
    /// Descending
    Desc,
}

/// Sort Mode
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SortMode {
    /// Minimum
    Min,
    /// Maximum
    Max,
    /// Sum
    Sum,
    /// Average
    Avg,
    /// Median
    Median,
}

/// Field Sort
#[derive(Debug, Clone, Serialize)]
pub struct FieldSort<'a> {
    /// The field to sort on
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// Sort order
    pub order: SortOrder,
    /// Missing value
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(borrow)]
    pub missing: Option<Cow<'a, str>>,
    /// Unmapped type
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(borrow)]
    pub unmapped_type: Option<Cow<'a, str>>,
}

/// Score sort with order
#[derive(Debug, Clone, Serialize)]
pub struct ScoreWithOrderSort {
    /// Sort order
    pub order: SortOrder,
}

impl<'a> FieldSort<'a> {
    /// Create a new FieldSort
    pub fn new(field: impl Into<Cow<'a, str>>, order: SortOrder) -> Self {
        Self {
            field: field.into(),
            order,
            missing: None,
            unmapped_type: None,
        }
    }

    /// Set the missing value
    pub fn missing(mut self, missing: impl Into<Cow<'a, str>>) -> Self {
        self.missing = Some(missing.into());
        self
    }

    /// Set the unmapped type
    pub fn unmapped_type(mut self, unmapped_type: impl Into<Cow<'a, str>>) -> Self {
        self.unmapped_type = Some(unmapped_type.into());
        self
    }
}

impl ScoreWithOrderSort {
    /// Create a new ScoreWithOrderSort
    pub fn new(order: SortOrder) -> Self {
        Self { order }
    }
}

impl<'a> ToOpenSearchJson for FieldSort<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();

        // Use simplified format when there are no additional parameters
        if self.missing.is_none() && self.unmapped_type.is_none() {
            result.insert(
                self.field.to_string(),
                Value::String(match self.order {
                    SortOrder::Asc => "asc".to_string(),
                    SortOrder::Desc => "desc".to_string(),
                }),
            );
        } else {
            // Use object format when there are additional parameters
            let mut field_obj = Map::new();
            field_obj.insert(
                "order".to_string(),
                Value::String(match self.order {
                    SortOrder::Asc => "asc".to_string(),
                    SortOrder::Desc => "desc".to_string(),
                }),
            );

            if let Some(ref missing) = self.missing {
                field_obj.insert("missing".to_string(), Value::String(missing.to_string()));
            }

            if let Some(ref unmapped_type) = self.unmapped_type {
                field_obj.insert(
                    "unmapped_type".to_string(),
                    Value::String(unmapped_type.to_string()),
                );
            }

            result.insert(self.field.to_string(), Value::Object(field_obj));
        }

        Value::Object(result)
    }
}

impl ToOpenSearchJson for ScoreWithOrderSort {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        result.insert(
            "_score".to_string(),
            Value::String(match self.order {
                SortOrder::Asc => "asc".to_string(),
                SortOrder::Desc => "desc".to_string(),
            }),
        );
        Value::Object(result)
    }
}

/// Sort Type
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "params")]
pub enum SortType<'a> {
    /// Field sort
    Field(FieldSort<'a>),
    /// Score sort
    Score,
    /// Score with sort order
    ScoreWithOrder(ScoreWithOrderSort),
    /// Script sort
    ScriptSort(ScriptSort<'a>),
}
impl<'a> ToOpenSearchJson for SortType<'a> {
    fn to_json(&self) -> Value {
        match self {
            SortType::Field(field_sort) => field_sort.to_json(),
            SortType::Score => serde_json::json!("_score"),
            SortType::ScoreWithOrder(score_sort) => score_sort.to_json(),
            SortType::ScriptSort(script_sort) => script_sort.to_json(),
        }
    }
}

#[cfg(test)]
mod test;
