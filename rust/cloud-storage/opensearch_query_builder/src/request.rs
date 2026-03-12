use std::borrow::Cow;
use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::util::is_empty_slice;
use crate::{QueryType, ToOpenSearchJson};

mod aggregation_type;
mod collapse;
mod highlight;
mod sort_type;

pub use aggregation_type::*;
pub use collapse::*;
pub use highlight::*;
pub use sort_type::*;

/// Struct representing a search request.
#[derive(Default, Debug, Clone, Serialize)]
pub struct SearchRequest<'a> {
    /// Query
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<QueryType<'a>>,
    /// Maximum number of results to return
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
    /// Offset
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<u32>,
    /// Sort criteria
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub sort: Cow<'a, [SortType<'a>]>,
    /// Aggregations
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    #[serde(borrow)]
    pub aggs: HashMap<Cow<'a, str>, AggregationType<'a>>,
    /// Source fields
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub _source: Cow<'a, [Cow<'a, str>]>,
    /// Highlight
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<Highlight<'a>>,
    /// Track total hits
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_total_hits: Option<bool>,
    /// Collapse
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<Collapse<'a>>,
    /// Search after (cursor-based pagination)
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub search_after: Cow<'a, [Value]>,
}

impl<'a> SearchRequest<'a> {
    /// Create a new SearchRequest
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the query
    pub fn query(mut self, query: QueryType<'a>) -> Self {
        self.query = Some(query);
        self
    }

    /// Set the maximum number of results to return
    pub fn size(mut self, size: u32) -> Self {
        self.size = Some(size);
        self
    }

    /// Set the offset
    pub fn from(mut self, from: u32) -> Self {
        self.from = Some(from);
        self
    }

    /// Add a sort criterion
    pub fn sort(mut self, sort: SortType<'a>) -> Self {
        self.sort.to_mut().push(sort);
        self
    }

    /// Add an aggregation
    pub fn agg(mut self, name: impl Into<Cow<'a, str>>, agg: AggregationType<'a>) -> Self {
        self.aggs.insert(name.into(), agg);
        self
    }

    /// Set source fields
    pub fn source_fields<I>(mut self, fields: I) -> Self
    where
        I: IntoIterator,
        I::Item: Into<Cow<'a, str>>,
    {
        self._source = fields.into_iter().map(|s| s.into()).collect();
        self
    }

    /// Set the highlight configuration
    pub fn highlight(mut self, highlight: Highlight<'a>) -> Self {
        self.highlight = Some(highlight);
        self
    }

    /// Set whether to track total hits
    pub fn track_total_hits(mut self, track: bool) -> Self {
        self.track_total_hits = Some(track);
        self
    }

    /// Set the collapse configuration
    pub fn collapse(mut self, collapse: Collapse<'a>) -> Self {
        self.collapse = Some(collapse);
        self
    }

    /// Set search_after for cursor-based pagination
    pub fn search_after<I>(mut self, values: I) -> Self
    where
        I: Into<Cow<'a, [Value]>>,
    {
        self.search_after = values.into();
        self
    }
}

impl<'a> ToOpenSearchJson for SearchRequest<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();

        if let Some(ref query) = self.query {
            result.insert("query".to_string(), query.to_json());
        }

        if let Some(size) = self.size {
            result.insert("size".to_string(), Value::Number(size.into()));
        }

        if let Some(from) = self.from {
            result.insert("from".to_string(), Value::Number(from.into()));
        }

        if !self.sort.is_empty() {
            let sorts: Vec<Value> = self.sort.iter().map(|s| s.to_json()).collect();
            result.insert("sort".to_string(), Value::Array(sorts));
        }

        if !self.aggs.is_empty() {
            let mut aggs_obj = Map::new();
            for (name, agg) in &self.aggs {
                aggs_obj.insert(name.to_string(), agg.to_json());
            }
            result.insert("aggs".to_string(), Value::Object(aggs_obj));
        }

        if !self._source.is_empty() {
            let sources: Vec<Value> = self
                ._source
                .iter()
                .map(|s| Value::String(s.to_string()))
                .collect();
            result.insert("_source".to_string(), Value::Array(sources));
        }

        if let Some(ref highlight) = self.highlight {
            result.insert("highlight".to_string(), highlight.to_json());
        }

        if let Some(track_total_hits) = self.track_total_hits {
            result.insert(
                "track_total_hits".to_string(),
                Value::Bool(track_total_hits),
            );
        }

        if let Some(ref collapse) = self.collapse {
            result.insert("collapse".to_string(), collapse.to_json());
        }

        if !self.search_after.is_empty() {
            result.insert(
                "search_after".to_string(),
                Value::Array(self.search_after.to_vec()),
            );
        }

        Value::Object(result)
    }
}

/// Builder pattern for SearchRequest that allows dynamic updates.
/// Unlike the fluent methods on SearchRequest, this builder uses mutable methods
/// so you can dynamically add fields over time before calling build().
#[derive(Default, Debug, Clone)]
pub struct SearchRequestBuilder<'a> {
    query: Option<QueryType<'a>>,
    size: Option<u32>,
    from: Option<u32>,
    sort: Cow<'a, [SortType<'a>]>,
    aggs: HashMap<Cow<'a, str>, AggregationType<'a>>,
    _source: Cow<'a, [Cow<'a, str>]>,
    highlight: Option<Highlight<'a>>,
    track_total_hits: Option<bool>,
    collapse: Option<Collapse<'a>>,
    search_after: Cow<'a, [Value]>,
}

impl<'a> SearchRequestBuilder<'a> {
    /// Create a new empty SearchRequestBuilder
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the query for this search request
    pub fn query(&mut self, query: QueryType<'a>) -> &mut Self {
        self.query = Some(query);
        self
    }

    /// Set the maximum number of results to return
    pub fn size(&mut self, size: u32) -> &mut Self {
        self.size = Some(size);
        self
    }

    /// Set the offset for pagination
    pub fn from(&mut self, from: u32) -> &mut Self {
        self.from = Some(from);
        self
    }

    /// Add a sort criterion (can be called multiple times)
    pub fn add_sort(&mut self, sort: SortType<'a>) -> &mut Self {
        self.sort.to_mut().push(sort);
        self
    }

    /// Set all sort criteria at once (replaces existing sorts)
    pub fn set_sorts(&mut self, sorts: Cow<'a, [SortType<'a>]>) -> &mut Self {
        self.sort = sorts;
        self
    }

    /// Clear all sort criteria
    pub fn clear_sorts(&mut self) -> &mut Self {
        self.sort = Cow::Borrowed(&[]);
        self
    }

    /// Add an aggregation
    pub fn add_agg(
        &mut self,
        name: impl Into<Cow<'a, str>>,
        agg: AggregationType<'a>,
    ) -> &mut Self {
        self.aggs.insert(name.into(), agg);
        self
    }

    /// Remove an aggregation by name
    pub fn remove_agg(&mut self, name: impl Into<Cow<'a, str>>) -> &mut Self {
        self.aggs.remove(&name.into());
        self
    }

    /// Clear all aggregations
    pub fn clear_aggs(&mut self) -> &mut Self {
        self.aggs.clear();
        self
    }

    /// Add a source field to include in the response
    pub fn add_source_field(&mut self, field: impl Into<Cow<'a, str>>) -> &mut Self {
        self._source.to_mut().push(field.into());
        self
    }

    /// Set source fields (replaces existing fields)
    pub fn set_source_fields<I>(&mut self, fields: I) -> &mut Self
    where
        I: IntoIterator,
        I::Item: Into<Cow<'a, str>>,
    {
        self._source = fields.into_iter().map(|s| s.into()).collect();
        self
    }

    /// Clear all source fields
    pub fn clear_source_fields(&mut self) -> &mut Self {
        self._source = Cow::Borrowed(&[]);
        self
    }

    /// Set the highlight configuration
    pub fn highlight(&mut self, highlight: Highlight<'a>) -> &mut Self {
        self.highlight = Some(highlight);
        self
    }

    /// Set whether to track total hits
    pub fn track_total_hits(&mut self, track: bool) -> &mut Self {
        self.track_total_hits = Some(track);
        self
    }

    /// Set the collapse configuration
    pub fn collapse(&mut self, collapse: Collapse<'a>) -> &mut Self {
        self.collapse = Some(collapse);
        self
    }

    /// Add a value to search_after for cursor-based pagination
    pub fn add_search_after_value(&mut self, value: Value) -> &mut Self {
        self.search_after.to_mut().push(value);
        self
    }

    /// Set search_after values (replaces existing values)
    pub fn set_search_after<I>(&mut self, values: I) -> &mut Self
    where
        I: Into<Cow<'a, [Value]>>,
    {
        self.search_after = values.into();
        self
    }

    /// Clear all search_after values
    pub fn clear_search_after(&mut self) -> &mut Self {
        self.search_after = Cow::Borrowed(&[]);
        self
    }

    /// Build the final SearchRequest
    pub fn build(self) -> SearchRequest<'a> {
        SearchRequest {
            query: self.query,
            size: self.size,
            from: self.from,
            sort: self.sort,
            aggs: self.aggs,
            _source: self._source,
            highlight: self.highlight,
            track_total_hits: self.track_total_hits,
            collapse: self.collapse,
            search_after: self.search_after,
        }
    }
}
