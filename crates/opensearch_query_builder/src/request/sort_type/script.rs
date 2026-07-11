use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{SortMode, SortOrder, ToOpenSearchJson};

/// Script Sort Type
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScriptSortType {
    /// Number - for numeric values (long, double, float, int)
    Number,
    /// String - for string/text values (lexicographic sorting)
    String,
    /// Version - for version strings (e.g., "1.2.3")
    Version,
}

/// Script Lang
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    /// Default and recommended scripting language (Java-like syntax)
    #[default]
    Painless,
    /// Fast, lightweight expressions (limited functionality, numeric operations only)
    Expression,
    /// Template language (mainly for search templates, not for sort scripts)
    Mustache,
}

/// Script
#[derive(Debug, Clone, Serialize, Default)]
pub struct Script<'a> {
    /// The script
    pub source: Cow<'a, str>,
    /// The lang to use (defaults to painless)
    pub lang: Lang,
    /// The params to inject into the source
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl<'a> Script<'a> {
    /// Create a new Script with the given source
    pub fn new(source: impl Into<Cow<'a, str>>) -> Self {
        Self {
            source: source.into(),
            lang: Lang::default(),
            params: None,
        }
    }

    /// Set the script language
    pub fn lang(mut self, lang: Lang) -> Self {
        self.lang = lang;
        self
    }

    /// Set the script parameters
    pub fn params(mut self, params: serde_json::Value) -> Self {
        self.params = Some(params);
        self
    }
}

/// Script Sort
#[derive(Debug, Clone, Serialize)]
pub struct ScriptSort<'a> {
    /// The type of the script sort
    #[serde(rename = "type")]
    pub sort_type: ScriptSortType,
    /// The script
    pub script: Script<'a>,
    /// The sort order
    pub order: SortOrder,
    /// The mode for the script
    /// Only relevant for multi-value scripts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<SortMode>,
}

impl<'a> ScriptSort<'a> {
    /// Create a new ScriptSort with the given script, type, and order
    pub fn new(script: Script<'a>, sort_type: ScriptSortType, order: SortOrder) -> Self {
        Self {
            sort_type,
            script,
            order,
            mode: None,
        }
    }

    /// Set the sort mode
    pub fn mode(mut self, mode: SortMode) -> Self {
        self.mode = Some(mode);
        self
    }
}

impl<'a> ToOpenSearchJson for ScriptSort<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();
        let mut script_obj = Map::new();

        // Add type
        script_obj.insert(
            "type".to_string(),
            Value::String(match self.sort_type {
                ScriptSortType::Number => "number".to_string(),
                ScriptSortType::String => "string".to_string(),
                ScriptSortType::Version => "version".to_string(),
            }),
        );

        // Add script
        script_obj.insert(
            "script".to_string(),
            serde_json::to_value(&self.script).expect("Failed to serialize script"),
        );

        // Add order
        script_obj.insert(
            "order".to_string(),
            Value::String(match self.order {
                SortOrder::Asc => "asc".to_string(),
                SortOrder::Desc => "desc".to_string(),
            }),
        );

        // Add mode if present
        if let Some(ref mode) = self.mode {
            script_obj.insert(
                "mode".to_string(),
                serde_json::to_value(mode).expect("Failed to serialize mode"),
            );
        }

        result.insert("_script".to_string(), Value::Object(script_obj));
        Value::Object(result)
    }
}

#[cfg(test)]
mod test;
