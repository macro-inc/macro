use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{QueryType, ToOpenSearchJson};

/// `has_child` join query. Returns parent documents that have at least one
/// child of `child_type` matching `query`.
///
/// Combine multiple `has_child` clauses inside a `bool.must` to require that
/// *every* term matches in *some* child (not necessarily the same one) —
/// the multi-term-AND-across-chunks semantics.
#[derive(Debug, Clone, Serialize)]
pub struct HasChildQuery<'a> {
    /// Name of the child relation defined in the join field mapping.
    #[serde(borrow)]
    pub child_type: Cow<'a, str>,
    /// Inner query to run against children. A parent matches if any one of
    /// its children matches this inner query.
    pub query: Box<QueryType<'a>>,
    /// If set, returns matching children alongside the parent. Each
    /// has_child clause's `inner_hits` is independent — name them to
    /// disambiguate when multiple has_child clauses appear in the same bool.
    pub inner_hits: Option<InnerHits<'a>>,
    /// Minimum number of distinct matching children required (default 1).
    pub min_children: Option<u32>,
    /// Maximum number of matching children (parents with more are excluded).
    pub max_children: Option<u32>,
    /// How child scores aggregate into the parent score. Default `none`.
    /// One of: `none`, `avg`, `max`, `min`, `sum`.
    pub score_mode: Option<Cow<'a, str>>,
    /// If true, suppress errors when `child_type` is not mapped in the
    /// target index. Useful for unified queries that span heterogeneous
    /// indices, only some of which use the join shape.
    pub ignore_unmapped: Option<bool>,
}

/// `inner_hits` clause attached to a parent/child join query. Returns the
/// underlying matching child docs inside the parent hit.
#[derive(Debug, Clone, Serialize)]
pub struct InnerHits<'a> {
    /// Optional name used to disambiguate this clause in the response.
    pub name: Option<Cow<'a, str>>,
    /// Optional highlight config to apply to the matching children.
    pub highlight: Option<Value>,
    /// Optional size override (default 3 in OpenSearch).
    pub size: Option<u32>,
}

impl<'a> InnerHits<'a> {
    /// Create a new InnerHits with no overrides.
    pub fn new() -> Self {
        Self {
            name: None,
            highlight: None,
            size: None,
        }
    }

    /// Set the inner_hits name (used to key the inner hits in the response).
    pub fn name(mut self, name: impl Into<Cow<'a, str>>) -> Self {
        self.name = Some(name.into());
        self
    }

    /// Set the highlight config (raw JSON value, since the existing
    /// Highlight builder type isn't visible from this crate).
    pub fn highlight(mut self, highlight: Value) -> Self {
        self.highlight = Some(highlight);
        self
    }

    /// Set the maximum number of inner hits to return.
    pub fn size(mut self, size: u32) -> Self {
        self.size = Some(size);
        self
    }

    /// Convert to an owned version with 'static lifetime.
    pub fn to_owned(&self) -> InnerHits<'static> {
        InnerHits {
            name: self.name.as_ref().map(|n| Cow::Owned(n.to_string())),
            highlight: self.highlight.clone(),
            size: self.size,
        }
    }
}

impl<'a> Default for InnerHits<'a> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> ToOpenSearchJson for InnerHits<'a> {
    fn to_json(&self) -> Value {
        let mut obj = Map::new();
        if let Some(name) = &self.name {
            obj.insert("name".to_string(), Value::String(name.to_string()));
        }
        if let Some(highlight) = &self.highlight {
            obj.insert("highlight".to_string(), highlight.clone());
        }
        if let Some(size) = self.size {
            obj.insert("size".to_string(), Value::Number(size.into()));
        }
        Value::Object(obj)
    }
}

impl<'a> HasChildQuery<'a> {
    /// Create a new has_child query against `child_type` running `query`.
    pub fn new(child_type: impl Into<Cow<'a, str>>, query: QueryType<'a>) -> Self {
        Self {
            child_type: child_type.into(),
            query: Box::new(query),
            inner_hits: None,
            min_children: None,
            max_children: None,
            score_mode: None,
            ignore_unmapped: None,
        }
    }

    /// Attach an inner_hits clause so the matching children come back with
    /// the parent.
    pub fn inner_hits(mut self, inner_hits: InnerHits<'a>) -> Self {
        self.inner_hits = Some(inner_hits);
        self
    }

    /// Set the minimum number of matching children required.
    pub fn min_children(mut self, min: u32) -> Self {
        self.min_children = Some(min);
        self
    }

    /// Set the maximum number of matching children allowed.
    pub fn max_children(mut self, max: u32) -> Self {
        self.max_children = Some(max);
        self
    }

    /// Configure how child scores aggregate into the parent.
    pub fn score_mode(mut self, mode: impl Into<Cow<'a, str>>) -> Self {
        self.score_mode = Some(mode.into());
        self
    }

    /// Ignore mapping errors when the child relation is missing on the
    /// target index.
    pub fn ignore_unmapped(mut self, ignore: bool) -> Self {
        self.ignore_unmapped = Some(ignore);
        self
    }

    /// Convert to an owned version with 'static lifetime.
    pub fn to_owned(&self) -> HasChildQuery<'static> {
        HasChildQuery {
            child_type: Cow::Owned(self.child_type.to_string()),
            query: Box::new((*self.query).to_owned()),
            inner_hits: self.inner_hits.as_ref().map(|h| h.to_owned()),
            min_children: self.min_children,
            max_children: self.max_children,
            score_mode: self.score_mode.as_ref().map(|m| Cow::Owned(m.to_string())),
            ignore_unmapped: self.ignore_unmapped,
        }
    }
}

impl<'a> From<HasChildQuery<'a>> for QueryType<'a> {
    fn from(q: HasChildQuery<'a>) -> Self {
        QueryType::HasChild(q)
    }
}

impl<'a> ToOpenSearchJson for HasChildQuery<'a> {
    fn to_json(&self) -> Value {
        let mut inner = Map::new();
        inner.insert(
            "type".to_string(),
            Value::String(self.child_type.to_string()),
        );
        inner.insert("query".to_string(), self.query.to_json());
        if let Some(inner_hits) = &self.inner_hits {
            inner.insert("inner_hits".to_string(), inner_hits.to_json());
        }
        if let Some(min) = self.min_children {
            inner.insert("min_children".to_string(), Value::Number(min.into()));
        }
        if let Some(max) = self.max_children {
            inner.insert("max_children".to_string(), Value::Number(max.into()));
        }
        if let Some(mode) = &self.score_mode {
            inner.insert("score_mode".to_string(), Value::String(mode.to_string()));
        }
        if let Some(ignore) = self.ignore_unmapped {
            inner.insert("ignore_unmapped".to_string(), Value::Bool(ignore));
        }
        let mut outer = Map::new();
        outer.insert("has_child".to_string(), Value::Object(inner));
        Value::Object(outer)
    }
}
