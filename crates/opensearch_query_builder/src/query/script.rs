use std::borrow::Cow;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{Lang, QueryType, Script, ToOpenSearchJson};

/// Script query: matches the documents its script returns true for. It reads
/// doc values, so it filters fields stored for sorting only, and a highlighter
/// never walks into it.
#[derive(Debug, Clone, Serialize)]
pub struct ScriptQuery<'a> {
    /// The script, run once per candidate document.
    #[serde(borrow)]
    pub script: Script<'a>,
}

impl<'a> ScriptQuery<'a> {
    /// Create a new ScriptQuery
    pub fn new(script: Script<'a>) -> Self {
        Self { script }
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> ScriptQuery<'static> {
        ScriptQuery {
            script: Script {
                source: Cow::Owned(self.script.source.to_string()),
                lang: self.script.lang.clone(),
                params: self.script.params.clone(),
            },
        }
    }
}

impl<'a> From<ScriptQuery<'a>> for QueryType<'a> {
    fn from(script_query: ScriptQuery<'a>) -> Self {
        QueryType::Script(script_query)
    }
}

impl<'a> ToOpenSearchJson for ScriptQuery<'a> {
    fn to_json(&self) -> Value {
        let lang = match self.script.lang {
            Lang::Painless => "painless",
            Lang::Expression => "expression",
            Lang::Mustache => "mustache",
        };
        let mut script = Map::new();
        script.insert(
            "source".to_string(),
            Value::String(self.script.source.to_string()),
        );
        script.insert("lang".to_string(), Value::String(lang.to_string()));
        if let Some(params) = &self.script.params {
            script.insert("params".to_string(), params.clone());
        }

        let mut query = Map::new();
        query.insert("script".to_string(), Value::Object(script));
        let mut result = Map::new();
        result.insert("script".to_string(), Value::Object(query));
        Value::Object(result)
    }
}

#[cfg(test)]
mod test;
