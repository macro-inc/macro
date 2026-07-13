use std::borrow::Cow;
use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::ToOpenSearchJson;
use crate::util::is_empty_slice;

/// Highlight
#[derive(Default, Debug, Clone, Serialize)]
pub struct Highlight<'a> {
    /// Fields to highlight
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    pub fields: HashMap<Cow<'a, str>, HighlightField<'a>>,
    /// Require field match
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_field_match: Option<bool>,
}

impl<'a> Highlight<'a> {
    /// Create a new Highlight
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a field to highlight
    pub fn field(
        mut self,
        field_name: impl Into<Cow<'a, str>>,
        highlight_field: HighlightField<'a>,
    ) -> Self {
        self.fields.insert(field_name.into(), highlight_field);
        self
    }

    /// Set whether to require field match
    pub fn require_field_match(mut self, require_field_match: bool) -> Self {
        self.require_field_match = Some(require_field_match);
        self
    }
}

impl<'a> ToOpenSearchJson for Highlight<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();

        if !self.fields.is_empty() {
            let mut fields_obj = Map::new();
            for (name, field) in &self.fields {
                fields_obj.insert(name.to_string(), field.to_json());
            }
            result.insert("fields".to_string(), Value::Object(fields_obj));
        }

        if let Some(require_field_match) = self.require_field_match {
            result.insert(
                "require_field_match".to_string(),
                Value::Bool(require_field_match),
            );
        }

        Value::Object(result)
    }
}

/// HighlightField
#[derive(Debug, Clone, Serialize)]
pub struct HighlightField<'a> {
    /// Highlight type
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub highlight_type: Option<Cow<'a, str>>,
    /// Number of fragments
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_of_fragments: Option<u32>,
    /// Pre-tags
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub pre_tags: Cow<'a, [Cow<'a, str>]>,
    /// Post-tags
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub post_tags: Cow<'a, [Cow<'a, str>]>,
}

impl<'a> Default for HighlightField<'a> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> HighlightField<'a> {
    /// Create a new HighlightField
    pub fn new() -> Self {
        Self {
            highlight_type: None,
            number_of_fragments: None,
            pre_tags: Cow::Borrowed(&[]),
            post_tags: Cow::Borrowed(&[]),
        }
    }

    /// Set the highlight type
    pub fn highlight_type(mut self, highlight_type: impl Into<Cow<'a, str>>) -> Self {
        self.highlight_type = Some(highlight_type.into());
        self
    }

    /// Set the number of fragments
    pub fn number_of_fragments(mut self, number_of_fragments: u32) -> Self {
        self.number_of_fragments = Some(number_of_fragments);
        self
    }

    /// Add pre-tags
    pub fn pre_tags<I, S>(mut self, pre_tags: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<Cow<'a, str>>,
    {
        self.pre_tags = pre_tags.into_iter().map(|s| s.into()).collect();
        self
    }

    /// Add post-tags
    pub fn post_tags<I, S>(mut self, post_tags: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<Cow<'a, str>>,
    {
        self.post_tags = post_tags.into_iter().map(|s| s.into()).collect();
        self
    }
}

impl<'a> ToOpenSearchJson for HighlightField<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();

        if let Some(ref highlight_type) = self.highlight_type {
            result.insert(
                "type".to_string(),
                Value::String(highlight_type.to_string()),
            );
        }

        if let Some(number_of_fragments) = self.number_of_fragments {
            result.insert(
                "number_of_fragments".to_string(),
                Value::Number(number_of_fragments.into()),
            );
        }

        if !self.pre_tags.is_empty() {
            let pre_tags: Vec<Value> = self
                .pre_tags
                .iter()
                .map(|tag| Value::String(tag.to_string()))
                .collect();
            result.insert("pre_tags".to_string(), Value::Array(pre_tags));
        }

        if !self.post_tags.is_empty() {
            let post_tags: Vec<Value> = self
                .post_tags
                .iter()
                .map(|tag| Value::String(tag.to_string()))
                .collect();
            result.insert("post_tags".to_string(), Value::Array(post_tags));
        }

        Value::Object(result)
    }
}
