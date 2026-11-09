//! Import policy shared by node types and transactions.
mod coercion;
pub use coercion::{js_string, js_to_number};
/// Serialized field containing extensible node state.
pub const NODE_STATE_KEY: &str = "$";
/// Controls which fields a custom node importer accepts.
#[derive(Clone, Copy, Debug)]
pub struct JsonImport {
    /// State names to preserve.
    pub state: StateImportFilter,
    /// Import framework fields through virtual setters.
    pub base_fields: bool,
    /// Import user payload fields.
    pub own_fields: bool,
}
impl JsonImport {
    /// All state, base and own fields.
    pub const FULL: Self = Self {
        state: StateImportFilter::All,
        base_fields: true,
        own_fields: true,
    };
}
/// Extensible node state filtering during import.
#[derive(Clone, Copy, Debug)]
pub enum StateImportFilter {
    /// Keep every state name.
    All,
    /// Keep only the listed names.
    Only(&'static [&'static str]),
    /// Drop all imported state.
    None,
}

use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
/// Pinned upstream semantics version.
pub const LEXICAL_VERSION: &str = "0.45.0";
/// An editor document; selection is intentionally not serialized.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SerializedEditorState {
    /// Serialized root and its descendants.
    pub root: SerializedNode,
}
/// Host-supplied epoch milliseconds; the model reads no clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct HistoryTime(pub u64);
/// The portable `@lexical/file` envelope.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedDocument {
    /// Document tree.
    pub editor_state: SerializedEditorState,
    /// Epoch milliseconds at save time.
    pub last_saved: u64,
    /// Origin of the document.
    pub source: String,
    /// Upstream semantics version.
    pub version: String,
}
impl SerializedDocument {
    /// Export with JavaScript's falsy fallback behavior for source and timestamp.
    pub fn from_state(
        state: &EditorState,
        source: Option<&str>,
        last_saved: Option<u64>,
        now: HistoryTime,
    ) -> Result<Self, Error> {
        Ok(Self {
            editor_state: state.to_json()?,
            last_saved: last_saved.filter(|time| *time != 0).unwrap_or(now.0),
            source: source
                .filter(|source| !source.is_empty())
                .unwrap_or("Lexical")
                .to_owned(),
            version: LEXICAL_VERSION.to_owned(),
        })
    }
}
impl EditorState {
    /// Export the root recursively, omitting the transient selection.
    pub fn to_json(&self) -> Result<SerializedEditorState, Error> {
        Ok(SerializedEditorState {
            root: self.view().export_node(NodeKey::ROOT)?,
        })
    }
}
impl Editor {
    /// Parse in an isolated pending state; errors leave the committed document intact.
    /// Parsing consumes keys but runs neither transforms nor normalization.
    pub fn parse_editor_state(
        &mut self,
        json: &SerializedEditorState,
    ) -> Result<EditorState, Error> {
        let report = self.parse_editor_state_report(json)?;
        if let Some(error) = report.error {
            return Err(error);
        }
        Ok(report.state)
    }
    /// Parse without publishing, retaining the partial state alongside its import diagnostic.
    /// Hosts with a logging error handler may inspect this report; the ordinary parser remains strict.
    pub fn parse_editor_state_report(
        &mut self,
        json: &SerializedEditorState,
    ) -> Result<ParsedEditorState, Error> {
        if json.root.get("type").and_then(Value::as_str) != Some("root") {
            return Err(Error::ExpectedSerializedRoot);
        }
        let mut tx = self.transaction();
        let shared = tx.pending.shared_state_configs.clone();
        tx.pending = EditorState::empty(tx.pending.registry.clone())?;
        tx.pending.shared_state_configs = shared;
        #[cfg(feature = "foreign-nodes")]
        {
            tx.pending.foreign_instances = tx.editor.foreign_instances.clone();
        }
        let error = tx.import_node(&json.root).err();
        Ok(ParsedEditorState {
            state: tx.pending.clone(),
            error,
        })
    }
    /// Parse a JSON document string without modifying the committed state.
    pub fn parse_editor_state_str(&mut self, json: &str) -> Result<EditorState, Error> {
        self.parse_editor_state(&serde_json::from_str(json)?)
    }
    /// Parse the document tree from a file envelope.
    pub fn state_from_serialized_document(
        &mut self,
        document: &SerializedDocument,
    ) -> Result<EditorState, Error> {
        self.parse_editor_state(&document.editor_state)
    }
    /// Decode a file envelope and parse its tree.
    pub fn state_from_serialized_document_str(
        &mut self,
        document: &str,
    ) -> Result<EditorState, Error> {
        self.state_from_serialized_document(&serde_json::from_str(document)?)
    }
}
/// Match JavaScript truthiness for JSON-representable values.
pub fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value
            .as_f64()
            .is_some_and(|value| value != 0.0 && !value.is_nan()),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
/// Represent finite integral doubles exactly as JSON integers where possible.
/// Non-finite doubles stringify as null in JavaScript.
pub fn js_number(value: f64) -> Value {
    if !value.is_finite() {
        Value::Null
    } else if value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_992.0 {
        Value::from(value as i64)
    } else {
        Value::from(value)
    }
}
/// Serde adapter for user-owned floating point fields.
pub fn serialize_js_number<S: serde::Serializer>(
    value: &f64,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    js_number(*value).serialize(serializer)
}
/// Match JSON.stringify ordering, floating point notation and string escapes.
pub fn to_js_json_string(value: &Value) -> String {
    let mut output = String::new();
    write_json(value, &mut output);
    output
}
fn array_index(key: &str) -> Option<u32> {
    key.parse::<u32>()
        .ok()
        .filter(|index| *index != u32::MAX && index.to_string() == key)
}
fn write_json(value: &Value, output: &mut String) {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(number) => {
            if let Some(number) = number.as_f64() {
                output.push_str(ryu_js::Buffer::new().format(number));
            } else {
                output.push_str("null");
            }
        }
        Value::String(_) => output.push_str(&value.to_string()),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_json(value, output);
            }
            output.push(']');
        }
        Value::Object(object) => {
            output.push('{');
            let mut indexed: Vec<_> = object
                .iter()
                .filter_map(|(key, value)| array_index(key).map(|index| (index, key, value)))
                .collect();
            indexed.sort_by_key(|(index, _, _)| *index);
            let fields = indexed
                .into_iter()
                .map(|(_, key, value)| (key, value))
                .chain(object.iter().filter(|(key, _)| array_index(key).is_none()));
            for (index, (key, value)) in fields.enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&Value::String(key.clone()).to_string());
                output.push(':');
                write_json(value, output);
            }
            output.push('}');
        }
    }
}
#[cfg(test)]
mod test;

/// Non-publishing parse result for a host that handles import diagnostics explicitly.
pub struct ParsedEditorState {
    /// Complete state on success, or the state reached before the first import error.
    pub state: EditorState,
    /// First import failure, if the parse stopped early.
    pub error: Option<Error>,
}
